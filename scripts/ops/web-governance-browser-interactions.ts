import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
} from "playwright-core";
import {
  computeProductExperienceSourceHash,
  currentGitCommit,
} from "../quality/product-experience-source";
import {
  createG8ScreenshotEvidence,
  readG8PoolEvidenceFromEnvironment,
  type G8ScreenshotEvidence,
} from "../quality/g8-browser-evidence-common";

const root = process.cwd();
const baseUrl = normalizeLoopbackBaseUrl(
  process.env.AREAFORGE_GOVERNANCE_BASE_URL ?? process.argv[2],
);
const runId = process.env.AREAFORGE_GOVERNANCE_RUN_ID
  ?? `governance-g8-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const outputDirectory = resolveOutputDirectory(
  process.env.AREAFORGE_GOVERNANCE_OUTPUT_DIR ?? `output/playwright/${runId}`,
);

interface TelemetryBucket {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  errorResponses: string[];
  expectedErrorResponses: string[];
}

interface ScenarioOutput {
  facts: Record<string, unknown>;
  screenshots: G8ScreenshotEvidence[];
}

interface ScenarioResult extends ScenarioOutput, TelemetryBucket {
  id: string;
  viewport: string;
  passed: boolean;
  failure: string | null;
}

interface DraftEnvelope {
  version: number;
  updatedAt: number;
  value: {
    schemaVersion?: number;
    baseRevision?: number | null;
    values?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

async function main(): Promise<void> {
  if (existsSync(outputDirectory)) {
    throw new Error(`refusing to overwrite existing output directory: ${outputDirectory}`);
  }
  await mkdir(path.join(outputDirectory, "screenshots"), { recursive: true });

  const binding = {
    commit: currentGitCommit(root),
    sourceFingerprint: computeProductExperienceSourceHash(root),
  };
  const health = await readRuntimeHealth();
  assertRuntimeBinding(health, binding);

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExecutablePath(),
  });
  let results: ScenarioResult[] = [];
  try {
    const storageState = await authenticate(browser);
    results = await runScenarios(browser, storageState);
  } finally {
    await browser.close();
  }

  const completedBinding = {
    commit: currentGitCommit(root),
    sourceFingerprint: computeProductExperienceSourceHash(root),
  };
  const completedHealth = await readRuntimeHealth();
  assertRuntimeBinding(completedHealth, completedBinding);
  if (completedBinding.commit !== binding.commit || completedBinding.sourceFingerprint !== binding.sourceFingerprint) {
    throw new Error("source binding changed during interaction collection");
  }
  const failed = results.filter((result) => !result.passed);
  const artifact = {
    schemaVersion: "web-governance-browser-interactions-v2",
    runId,
    generatedAt: new Date().toISOString(),
    environment: {
      baseUrl: baseUrl.origin,
      browser: "chromium",
      mode: "local-production-build",
      pool: readPoolBinding("AREAFORGE_GOVERNANCE"),
    },
    binding: { ...completedBinding, capturePhase: "after-collection" as const },
    runtimeIdentity: completedHealth.runtimeIdentity,
    safety: {
      loopbackOnly: true,
      authentication: "local-demo-button",
      businessWrites: false,
      mutationRequests: "route-intercepted",
      migration: false,
      productionTouched: false,
    },
    summary: {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      consoleErrorCount: sum(results, "consoleErrors"),
      pageErrorCount: sum(results, "pageErrors"),
      failedRequestCount: sum(results, "failedRequests"),
      unexpectedErrorResponseCount: sum(results, "errorResponses"),
      expectedErrorResponseCount: sum(results, "expectedErrorResponses"),
      result: failed.length === 0 ? "PASS" : "FAIL",
    },
    results,
    screenshotEvidence: results.flatMap((result) => result.screenshots),
    doesNotProve: [
      "GitHub Release exists for this checkout",
      "production apply completed",
      "production health or production UX",
      "real AI provider behavior",
      "real upload persistence or attachment storage",
      "multi-device concurrency against a live server writer",
    ],
  };
  const artifactPath = path.join(outputDirectory, "web-governance-browser-interactions.json");
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  console.log(JSON.stringify({
    runId,
    artifact: path.relative(root, artifactPath),
    screenshots: path.relative(root, path.join(outputDirectory, "screenshots")),
    ...artifact.summary,
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

async function runScenarios(
  browser: Browser,
  storageState: Awaited<ReturnType<BrowserContext["storageState"]>>,
): Promise<ScenarioResult[]> {
  return [
    await runScenario(browser, storageState, "overlay-escape-focus", { width: 820, height: 1180 }, runOverlayScenario),
    await runScenario(browser, storageState, "draft-current", { width: 390, height: 844 }, (page) => runDraftScenario(page, "current")),
    await runScenario(browser, storageState, "draft-stale", { width: 390, height: 844 }, (page) => runDraftScenario(page, "stale")),
    await runScenario(browser, storageState, "draft-legacy", { width: 390, height: 844 }, (page) => runDraftScenario(page, "legacy")),
    await runScenario(
      browser,
      storageState,
      "resource-409-input-retention",
      { width: 390, height: 844 },
      runResourceConflictScenario,
      (response) => response.status() === 409
        && response.request().method() === "PATCH"
        && new URL(response.url()).pathname === "/api/study-resources/test-resource-link",
    ),
    await runScenario(browser, storageState, "ai-latest-wins", { width: 820, height: 1180 }, runAiScenario),
    await runScenario(browser, storageState, "upload-batch-lock", { width: 820, height: 1180 }, runUploadScenario),
  ];
}

async function runScenario(
  browser: Browser,
  storageState: Awaited<ReturnType<BrowserContext["storageState"]>>,
  id: string,
  viewport: { width: number; height: number },
  operation: (page: Page) => Promise<ScenarioOutput>,
  expectedErrorResponse?: (response: Response) => boolean,
): Promise<ScenarioResult> {
  const context = await browser.newContext({
    storageState,
    viewport,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  configurePage(page);
  const telemetry = attachTelemetry(page, expectedErrorResponse);
  let output: ScenarioOutput = { facts: {}, screenshots: [] };
  let failure: string | null = null;
  try {
    output = await operation(page);
    await settleFrames(page);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    try {
      output.screenshots.push(await capture(page, `${id}-failure`));
    } catch {
      // The page may already be unavailable after a navigation failure.
    }
  } finally {
    await context.close();
  }
  const snapshot = snapshotTelemetry(telemetry);
  return {
    id,
    viewport: `${viewport.width}x${viewport.height}`,
    ...output,
    ...snapshot,
    passed: failure === null && unexpectedIssueCount(snapshot) === 0,
    failure,
  };
}

async function runOverlayScenario(page: Page): Promise<ScenarioOutput> {
  await gotoApp(page, "/today");
  const navigationTrigger = page.getByRole("button", { name: "打开导航" });
  await navigationTrigger.focus();
  await navigationTrigger.click();
  const drawer = page.getByRole("dialog", { name: "AreaForge 导航" });
  await drawer.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  await waitForActiveElement(page, "打开导航");

  const confirmationTrigger = page.getByRole("button", { name: /^确认中心/ }).first();
  await confirmationTrigger.focus();
  await confirmationTrigger.click();
  const windowDialog = page.getByRole("dialog", { name: "确认中心", exact: true });
  await windowDialog.waitFor({ state: "visible" });
  const openScreenshot = await capture(page, "overlay-window-open");
  await page.keyboard.press("Escape");
  await windowDialog.waitFor({ state: "hidden" });
  await waitForActiveElement(page, "确认中心");
  assertScenario(await page.locator("[data-window-dock='true']").isVisible(), "窗口最小化后 Dock 未出现");
  return {
    facts: {
      drawerEscapeClosed: true,
      drawerFocusRestored: true,
      windowEscapeMinimized: true,
      windowFocusRestored: true,
      dockVisible: true,
    },
    screenshots: [openScreenshot],
  };
}

async function runDraftScenario(
  page: Page,
  status: "current" | "stale" | "legacy",
): Promise<ScenarioOutput> {
  await gotoApp(page, "/knowledge/resources/test-resource-link");
  await page.getByRole("button", { name: "整理资料" }).click();
  const title = page.getByLabel("标题", { exact: true });
  const marker = `G8-${status}-draft`;
  await title.fill(marker);
  const stored = await waitForResourceDraft(page);
  const baseRevision = Number(stored.envelope.value.baseRevision);
  assertScenario(Number.isSafeInteger(baseRevision), "当前资料草稿没有有效 baseRevision");

  if (status !== "current") {
    await page.evaluate(({ key, status: draftStatus }) => {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as DraftEnvelope | null;
      if (!parsed?.value.values) throw new Error("resource draft envelope is missing");
      if (draftStatus === "stale") {
        const current = Number(parsed.value.baseRevision);
        parsed.value.baseRevision = current === 0 ? 1 : current - 1;
      } else {
        parsed.value = parsed.value.values;
      }
      localStorage.setItem(key, JSON.stringify(parsed));
    }, { key: stored.key, status });
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await title.waitFor({ state: "visible" });
  assertScenario(await title.inputValue() === marker, `${status} 草稿没有恢复原输入`);
  const conflictDialog = page.getByRole("dialog", { name: "合并资料版本冲突" });
  if (status === "current") {
    assertScenario(await conflictDialog.count() === 0, "current 草稿不应进入冲突窗口");
  } else {
    await conflictDialog.waitFor({ state: "visible" });
    const save = page.getByRole("button", { name: "保存资料整理" });
    assertScenario(await save.isDisabled(), `${status} 草稿未处理冲突前不应允许保存`);
    const expectedCopy = status === "legacy" ? "旧版本机草稿" : "本机草稿基于";
    assertScenario(await page.getByText(new RegExp(expectedCopy)).isVisible(), `${status} 草稿缺少冲突说明`);
  }
  return {
    facts: {
      status,
      storageKeyPrefix: "areaforge.resource.draft.detail.",
      restoredValue: marker,
      baseRevision,
      conflictRequired: status !== "current",
      submitLockedBeforeResolution: status !== "current",
    },
    screenshots: [await capture(page, `resource-draft-${status}`)],
  };
}

async function runResourceConflictScenario(page: Page): Promise<ScenarioOutput> {
  await gotoApp(page, "/knowledge/resources/test-resource-link");
  const resourceResponse = await page.evaluate(async () => {
    const response = await fetch("/api/study-resources/test-resource-link", {
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json() as { resource?: Record<string, unknown> },
    };
  });
  assertScenario(resourceResponse.ok, `资料只读基线请求失败：${resourceResponse.status}`);
  const resourceBody = resourceResponse.body;
  assertScenario(Boolean(resourceBody.resource), "资料只读基线缺少 resource");
  const latest = {
    ...resourceBody.resource,
    title: "G8 服务端并发标题",
    revision: Number(resourceBody.resource?.revision) + 1,
    updatedAt: new Date().toISOString(),
  };
  const submitted: { value: Record<string, unknown> | null } = { value: null };
  await page.route("**/api/study-resources/test-resource-link", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    submitted.value = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "STUDY_RESOURCE_VERSION_CONFLICT",
        latest,
        conflictFields: ["revision", "title"],
      }),
    });
  });

  await page.getByRole("button", { name: "整理资料" }).click();
  const title = page.getByLabel("标题", { exact: true });
  const marker = "G8 本机冲突输入必须保留";
  await title.fill(marker);
  await page.getByRole("button", { name: "保存资料整理" }).click();
  const conflictDialog = page.getByRole("dialog", { name: "合并资料版本冲突" });
  await conflictDialog.waitFor({ state: "visible" });
  assertScenario(await title.inputValue() === marker, "409 后本机标题输入丢失");
  assertScenario(submitted.value?.title === marker, "409 请求没有冻结本机标题输入");
  assertScenario(
    await page.getByText("资料已在其他页面或设备更新。").isVisible(),
    "409 后没有显示人工冲突边界",
  );
  return {
    facts: {
      interceptedStatus: 409,
      submittedTitle: submitted.value?.title,
      retainedTitle: await title.inputValue(),
      conflictFields: ["revision", "title"],
      automaticOverwrite: false,
    },
    screenshots: [await capture(page, "resource-409-conflict")],
  };
}

async function runAiScenario(page: Page): Promise<ScenarioOutput> {
  let requestCount = 0;
  const requestTexts: string[] = [];
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route("**/api/ai/drafts/knowledge-card", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { selectedText?: string; phase?: string };
    requestCount += 1;
    requestTexts.push(body.selectedText ?? "");
    if (requestCount === 1) {
      await firstGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          previewToken: "g8-first-token",
          payloadPreview: { selectedText: "G8 FIRST" },
          note: "G8_FIRST_PREVIEW",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        previewToken: "g8-second-token",
        payloadPreview: { selectedText: "G8 SECOND" },
        note: "G8_SECOND_PREVIEW",
      }),
    });
  });

  await gotoApp(page, "/today");
  await page.getByRole("button", { name: "打开 AI 助手" }).click();
  const dialog = page.getByRole("dialog", { name: "AI 助手" });
  await dialog.waitFor({ state: "visible" });
  const text = dialog.getByLabel("选中文本");
  const preview = dialog.getByRole("button", { name: "发送前预览" });
  await text.fill("G8 FIRST");
  await preview.click();
  await waitForValue(() => requestCount, 1, "AI 首个预览请求没有发出");
  assertScenario(await preview.isDisabled(), "AI pending 期间预览按钮没有锁定");
  await preview.evaluate((element) => (element as HTMLButtonElement).click());
  await settleFrames(page);
  assertScenario(requestCount === 1, "AI pending 期间重复点击发出了第二个请求");

  await text.fill("G8 SECOND");
  await preview.waitFor({ state: "visible" });
  assertScenario(await preview.isEnabled(), "修改输入后没有失效旧请求并开放新预览");
  await preview.click();
  await dialog.getByText("G8_SECOND_PREVIEW").waitFor({ state: "visible" });
  releaseFirst();
  await waitForValue(() => requestCount, 2, "AI 第二个预览请求没有发出");
  await settleFrames(page);
  assertScenario(await dialog.getByText("G8_SECOND_PREVIEW").isVisible(), "迟到响应覆盖了最新 AI 预览");
  assertScenario(await dialog.getByText("G8_FIRST_PREVIEW").count() === 0, "旧 AI 预览仍出现在当前结果中");
  assertScenario(requestTexts[0] === "G8 FIRST" && requestTexts[1] === "G8 SECOND", "AI 请求输入快照不符合顺序");
  return {
    facts: {
      previewRequestCount: requestCount,
      duplicateClickRequestCount: 1,
      requestTexts,
      visiblePreview: "G8_SECOND_PREVIEW",
      stalePreviewVisible: false,
      pendingLocked: true,
    },
    screenshots: [await capture(page, "ai-latest-wins")],
  };
}

async function runUploadScenario(page: Page): Promise<ScenarioOutput> {
  let stageRequestCount = 0;
  let resolveRequestCount = 0;
  let stageBody = "";
  const resolveBody: { value: Record<string, unknown> | null } = { value: null };
  let releaseStage: () => void = () => {};
  const stageGate = new Promise<void>((resolve) => {
    releaseStage = resolve;
  });
  await page.route("**/api/study-resources/uploads/staging", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
      return;
    }
    stageRequestCount += 1;
    stageBody = route.request().postDataBuffer()?.toString("utf8") ?? "";
    await stageGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{
          index: 0,
          originalName: "governance-original.md",
          staging: {
            attachment: {
              id: "g8-staged-attachment",
              noteId: null,
              originalName: "governance-original.md",
              mimeType: "text/markdown",
              sizeBytes: 18,
              downloadApiPath: "/api/attachments/g8-staged-attachment",
              createdAt: new Date().toISOString(),
            },
            duplicates: [],
          },
          error: null,
        }],
      }),
    });
  });
  await page.route("**/api/study-resources/uploads/resolve", async (route) => {
    resolveRequestCount += 1;
    resolveBody.value = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ skipped: true }),
    });
  });

  await gotoApp(page, "/knowledge/resources?create=1");
  const drawer = page.getByRole("dialog", { name: "添加资料" });
  await drawer.waitFor({ state: "visible" });
  const subject = drawer.getByLabel("科目");
  const category = drawer.getByLabel("资料类型");
  const tags = drawer.getByLabel("标签");
  const file = drawer.locator("input[type='file']");
  await subject.selectOption("");
  await category.selectOption("COURSE");
  await tags.fill("alpha, beta");
  await file.setInputFiles({
    name: "governance-original.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# G8 frozen file\n", "utf8"),
  });
  const upload = drawer.getByRole("button", { name: "上传并逐项检查" });
  await upload.click();
  await waitForValue(() => stageRequestCount, 1, "上传 staging 请求没有发出");
  const uploadControlCount = await upload.count();
  const uploadControlUnavailable = uploadControlCount === 0 || await upload.isDisabled();
  assertScenario(uploadControlUnavailable, "上传批次 pending 期间提交入口仍可用");
  assertScenario(await subject.isDisabled() && await category.isDisabled() && await tags.isDisabled(), "上传批次 pending 期间元数据字段没有锁定");
  assertScenario(await file.isDisabled(), "上传批次 pending 期间文件选择没有锁定");
  assertScenario((await file.evaluate((input) => (input as HTMLInputElement).files?.[0]?.name)) === "governance-original.md", "锁定期间文件快照发生变化");
  if (uploadControlCount > 0) {
    await upload.evaluate((element) => (element as HTMLButtonElement).click());
  }
  await settleFrames(page);
  assertScenario(stageRequestCount === 1, "上传批次锁未阻止重复 staging 请求");
  const pendingScreenshot = await capture(page, "upload-batch-pending-lock");

  releaseStage();
  await waitForValue(() => resolveRequestCount, 1, "上传 resolve 请求没有发出");
  await page.getByText("已跳过").waitFor({ state: "visible" });
  assertScenario(stageBody.includes("governance-original.md"), "staging multipart 没有冻结原文件名");
  assertScenario(stageBody.includes("# G8 frozen file"), "staging multipart 没有冻结原文件内容");
  assertScenario(resolveBody.value?.attachmentId === "g8-staged-attachment", "resolve 没有使用 staging attachment 快照");
  assertScenario(resolveBody.value?.subjectId === null, "resolve 没有使用冻结的 subject 快照");
  assertScenario(resolveBody.value?.category === "COURSE", "resolve 没有使用冻结的 category 快照");
  assertScenario(JSON.stringify(resolveBody.value?.tags) === JSON.stringify(["alpha", "beta"]), "resolve 没有使用冻结的 tags 快照");
  return {
    facts: {
      stageRequestCount,
      resolveRequestCount,
      originalFileName: "governance-original.md",
      pendingControlsLocked: true,
      pendingSubmitControl: uploadControlCount === 0 ? "unmounted" : "disabled",
      duplicateClickSuppressed: true,
      resolvedSnapshot: resolveBody.value,
    },
    screenshots: [pendingScreenshot],
  };
}

async function waitForResourceDraft(page: Page): Promise<{ key: string; envelope: DraftEnvelope }> {
  await page.waitForFunction(() => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .some((key) => key?.startsWith("areaforge.resource.draft.detail.")));
  return page.evaluate(() => {
    const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .find((candidate) => candidate?.startsWith("areaforge.resource.draft.detail."));
    if (!key) throw new Error("resource detail draft key is unavailable");
    return { key, envelope: JSON.parse(localStorage.getItem(key) ?? "null") as DraftEnvelope };
  });
}

async function authenticate(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  try {
    const page = await context.newPage();
    configurePage(page);
    await page.goto(new URL("/login", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "填入本地演示账号" }).click();
    await page.getByRole("button", { name: "登录并继续学习" }).click();
    await page.waitForURL((candidate) => candidate.pathname === "/today");
    await settleFrames(page);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function gotoApp(page: Page, targetPath: string): Promise<void> {
  const response = await page.goto(new URL(targetPath, baseUrl).toString(), { waitUntil: "domcontentloaded" });
  assertScenario((response?.status() ?? 500) < 400, `${targetPath} 导航失败：${response?.status() ?? "no response"}`);
  await page.locator("main").first().waitFor({ state: "visible" });
  await settleFrames(page);
}

async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function waitForActiveElement(page: Page, accessibleNamePrefix: string): Promise<void> {
  await page.waitForFunction((prefix) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    const name = active.getAttribute("aria-label") ?? active.textContent?.trim() ?? "";
    return name.startsWith(prefix);
  }, accessibleNamePrefix);
}

async function waitForValue(
  read: () => number,
  expected: number,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (read() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${message}：expected=${expected} actual=${read()}`);
}

async function capture(page: Page, name: string): Promise<G8ScreenshotEvidence> {
  const absolute = path.join(outputDirectory, "screenshots", `${name}.png`);
  await page.screenshot({ path: absolute, fullPage: true });
  return createG8ScreenshotEvidence(root, path.relative(root, absolute));
}

function attachTelemetry(
  page: Page,
  expectedErrorResponse?: (response: Response) => boolean,
): TelemetryBucket {
  const telemetry: TelemetryBucket = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    errorResponses: [],
    expectedErrorResponses: [],
  };
  page.on("console", (message) => {
    // Chromium emits a generic console error for an intentionally intercepted
    // 409 response. The response listener records that case as expected below.
    if (message.type() === "error" && !(expectedErrorResponse && message.text().includes("Failed to load resource"))) {
      telemetry.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => telemetry.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (!isExpectedCancellation(request)) {
      telemetry.failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const label = `${response.status()} ${response.request().method()} ${response.url()}`;
    if (expectedErrorResponse?.(response)) telemetry.expectedErrorResponses.push(label);
    else telemetry.errorResponses.push(label);
  });
  return telemetry;
}

function snapshotTelemetry(bucket: TelemetryBucket): TelemetryBucket {
  return {
    consoleErrors: [...bucket.consoleErrors],
    pageErrors: [...bucket.pageErrors],
    failedRequests: [...bucket.failedRequests],
    errorResponses: [...bucket.errorResponses],
    expectedErrorResponses: [...bucket.expectedErrorResponses],
  };
}

function isExpectedCancellation(request: Request): boolean {
  const failure = request.failure()?.errorText ?? "";
  if (!failure.includes("ERR_ABORTED") && !failure.includes("NS_BINDING_ABORTED")) return false;
  const url = new URL(request.url());
  const headers = request.headers();
  return request.resourceType() === "fetch" && (headers.rsc === "1" || url.searchParams.has("_rsc"));
}

function unexpectedIssueCount(bucket: TelemetryBucket): number {
  return bucket.consoleErrors.length
    + bucket.pageErrors.length
    + bucket.failedRequests.length
    + bucket.errorResponses.length;
}

function sum(results: ScenarioResult[], key: keyof TelemetryBucket): number {
  return results.reduce((total, result) => total + result[key].length, 0);
}

function assertScenario(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRuntimeHealth(): Promise<{ runtimeIdentity?: Record<string, unknown>; [key: string]: unknown }> {
  const response = await fetch(new URL("/api/health", baseUrl), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`runtime health failed with ${response.status}`);
  return await response.json() as { runtimeIdentity?: Record<string, unknown>; [key: string]: unknown };
}

function assertRuntimeBinding(
  health: { runtimeIdentity?: Record<string, unknown> },
  binding: { commit: string; sourceFingerprint: string },
): void {
  const identity = health.runtimeIdentity;
  if (!identity || identity.status !== "verified" || identity.runtimeMode !== "production-build") {
    throw new Error("runtime identity is not a verified production build");
  }
  if (identity.gitCommit !== binding.commit || identity.productExperienceSourceHash !== binding.sourceFingerprint) {
    throw new Error("runtime identity does not match the current checkout");
  }
}

function normalizeLoopbackBaseUrl(value: string | undefined): URL {
  if (!value) throw new Error("usage: pnpm ops:web-governance:browser-interactions <latest-loopback-url>");
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("web governance browser interactions only accept an HTTP loopback URL");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function resolveOutputDirectory(relative: string): string {
  if (path.isAbsolute(relative) || !relative.startsWith("output/playwright/") || relative.includes("..")) {
    throw new Error("governance output directory must be a new repo-relative path under output/playwright/");
  }
  return path.join(root, relative);
}

function chromeExecutablePath(): string {
  const configured = process.env.CHROME_EXECUTABLE_PATH;
  if (configured) return configured;
  const bundled = chromium.executablePath();
  if (!existsSync(bundled)) throw new Error("Playwright Chromium is not installed");
  return bundled;
}

function readPoolBinding(prefix: string): ReturnType<typeof readG8PoolEvidenceFromEnvironment> {
  return readG8PoolEvidenceFromEnvironment(prefix, baseUrl.origin);
}

function configurePage(page: Page): void {
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
