import { createHash } from "node:crypto";
import type {
  APIResponse,
  Browser,
  BrowserContext,
  Page,
  Request,
  Response as PlaywrightResponse,
} from "playwright-core";
import {
  V11_JOURNEY_CONTRACTS,
  V11_VIEWPORT_CONTRACT,
  assertV11AssertionListContract,
  type V11Assertion,
  type V11JourneyEvidenceItem,
  type V11Viewport,
} from "../quality/v11-browser-evidence-contract";
import type {
  BrowserEvidenceConfig,
  JourneyFixture,
  JourneyId,
} from "./v11-browser-fixtures";
import {
  prepareFixtureActiveSession,
  releaseFixtureActiveSessions,
} from "./v11-browser-fixtures";

export type JourneyEvidenceItem = V11JourneyEvidenceItem;

export interface JourneyScreenshotWriter {
  write(name: string, bytes: Uint8Array): Promise<V11JourneyEvidenceItem["screenshot"]>;
}

interface OracleCapture {
  path: string;
  evidence: V11JourneyEvidenceItem["oracle"]["before"];
  body: unknown;
}

interface MutationCapture {
  evidence: JourneyEvidenceItem["mutation"];
  body: unknown;
}

interface ScenarioContext {
  page: Page;
  context: BrowserContext;
  config: BrowserEvidenceConfig;
  fixture: JourneyFixture;
}

const startPaths: Record<JourneyId, string> = {
  login: "/login",
  dashboard: "/today",
  "timer-closeout": "/focus/:sessionId?returnTo=%2Ftoday",
  review: "/review/daily",
  notes: "/knowledge/notes",
  syllabus: "/knowledge/syllabus",
  reports: "/review/reports?tab=current&period=week",
  simulation: "/stage/simulation",
  "update-center": "/settings/system",
};

export async function runJourneySuite(input: {
  browser: Browser;
  config: BrowserEvidenceConfig;
  fixtures: JourneyFixture[];
  screenshots: JourneyScreenshotWriter;
}): Promise<JourneyEvidenceItem[]> {
  const results: JourneyEvidenceItem[] = [];
  for (const fixture of input.fixtures) {
    await prepareFixtureActiveSession(fixture);
    try {
      results.push(await runJourney({ ...input, fixture }));
    } finally {
      await releaseFixtureActiveSessions(fixture);
    }
  }
  return results;
}

async function runJourney(input: {
  browser: Browser;
  config: BrowserEvidenceConfig;
  fixture: JourneyFixture;
  screenshots: JourneyScreenshotWriter;
}): Promise<JourneyEvidenceItem> {
  const viewport = contractViewport(input.fixture.viewport);
  const context = await input.browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: input.fixture.viewport === "mobile",
    hasTouch: input.fixture.viewport === "mobile",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(input.config.timeoutMs);
  page.setDefaultNavigationTimeout(input.config.timeoutMs);
  const telemetry = collectStrictTelemetry(page);
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  try {
    const scenario = await executeScenario({ page, context, config: input.config, fixture: input.fixture });
    const contract = V11_JOURNEY_CONTRACTS[input.fixture.journeyId];
    assertV11AssertionListContract(
      scenario.before.evidence.assertions,
      contract.beforeAssertions,
      `${input.fixture.journeyId} before oracle`,
    );
    assertV11AssertionListContract(
      scenario.after.evidence.assertions,
      contract.afterAssertions,
      `${input.fixture.journeyId} after oracle`,
    );
    assertV11AssertionListContract(
      scenario.terminalAssertions,
      contract.terminalAssertions,
      `${input.fixture.journeyId} terminal state`,
    );
    await page.waitForTimeout(150);
    const screenshotName = `${input.fixture.viewport}-${input.fixture.journeyId}.png`;
    const screenshotBytes = await page.screenshot({ type: "png", fullPage: false, animations: "disabled" });
    const screenshot = await input.screenshots.write(screenshotName, screenshotBytes);
    telemetry.assertEmpty();
    const completed = Date.now();
    return {
      id: `${input.fixture.viewport}-${input.fixture.journeyId}`,
      journey: input.fixture.journeyId,
      viewport,
      accountRef: input.fixture.accountRef,
      startPath: canonicalEvidenceRoute(resolveStartPath(input.fixture), contract.startPath),
      startedAt,
      finishedAt: new Date(completed).toISOString(),
      durationMs: completed - started,
      mutation: {
        ...scenario.mutation.evidence,
        path: canonicalEvidenceRoute(scenario.mutation.evidence.path, contract.mutation.path),
      },
      oracle: {
        method: "GET",
        path: scenario.before.path,
        before: scenario.before.evidence,
        after: scenario.after.evidence,
      },
      terminalPath: canonicalEvidenceRoute(currentPath(page), contract.terminalPath),
      terminalAssertions: scenario.terminalAssertions,
      screenshot,
      telemetry: {
        consoleErrors: [],
        pageErrors: [],
        requestFailures: [],
        httpFailures: [],
        unexplainedFailureCount: 0,
      },
      result: "pass",
    };
  } finally {
    telemetry.stop();
    await context.close();
  }
}

async function executeScenario(input: ScenarioContext): Promise<{
  before: OracleCapture;
  mutation: MutationCapture;
  after: OracleCapture;
  terminalAssertions: V11Assertion[];
}> {
  if (input.fixture.journeyId === "login") return runLoginJourney(input);
  await loginThroughUi(input.page, input.config, input.fixture, resolveStartPath(input.fixture));
  switch (input.fixture.journeyId) {
    case "dashboard": return runDashboardJourney(input);
    case "timer-closeout": return runTimerCloseoutJourney(input);
    case "review": return runReviewJourney(input);
    case "notes": return runNotesJourney(input);
    case "syllabus": return runSyllabusJourney(input);
    case "reports": return runReportsJourney(input);
    case "simulation": return runSimulationJourney(input);
    case "update-center": return runUpdateCenterJourney(input);
  }
}

async function runLoginJourney(input: ScenarioContext) {
  const before = await captureOracle(input.context, input.config, "/api/dashboard/today", (status) => [
    assertion("unauthenticated-before", 401, status),
  ]);
  const mutation = await loginThroughUi(input.page, input.config, input.fixture, "/today");
  const after = await captureOracle(input.context, input.config, "/api/dashboard/today", (status, body) => [
    assertion("authenticated-after", 200, status),
    assertion("dashboard-present", true, Boolean(asRecord(body).dashboard)),
  ]);
  assertOracleChanged(before, after);
  await input.page.getByRole("heading", { name: "今日", level: 1 }).waitFor({ state: "visible" });
  return {
    before,
    mutation,
    after,
    terminalAssertions: await terminalAssertions(input.page, [
      ["today-heading", () => input.page.getByRole("heading", { name: "今日", level: 1 }).isVisible()],
      ["authenticated-route", () => Promise.resolve(currentPath(input.page) === "/today")],
    ]),
  };
}

async function runDashboardJourney(input: ScenarioContext) {
  const before = await activeSessionOracle(input, "active-session-before", false);
  const section = input.page.getByRole("heading", { name: "科目快捷计时" }).locator("..");
  await section.getByRole("button", { name: "开始", exact: true }).first().click();
  const dialog = input.page.getByRole("dialog", { name: "确认科目快捷计时" });
  await dialog.waitFor({ state: "visible" });
  const mutation = await captureUiMutation(input.page, input.config, {
    method: "POST",
    path: "/api/study-sessions/start",
    expectedStatus: 201,
  }, () => dialog.getByRole("button", { name: "确认开始" }).click());
  await input.page.waitForURL((url) => url.pathname.startsWith("/focus/"));
  const sessionId = stringField(asRecord(mutation.body).session, "id");
  const after = await activeSessionOracle(input, "active-session-after", true, sessionId);
  assertOracleChanged(before, after);
  return {
    before,
    mutation,
    after,
    terminalAssertions: await terminalAssertions(input.page, [
      ["focus-route", () => Promise.resolve(currentPath(input.page).startsWith("/focus/"))],
      ["focus-heading", () => input.page.getByRole("heading", { level: 1 }).isVisible()],
    ]),
  };
}

async function runTimerCloseoutJourney(input: ScenarioContext) {
  const sessionId = requiredFixtureValue(input.fixture.activeSessionId, "timer fixture session");
  const before = await activeSessionOracle(input, "fixture-session-active", true, sessionId);
  await input.page.getByRole("button", { name: "结束并收口" }).click();
  const form = input.page.getByRole("heading", { name: "收口确认" }).locator("..");
  await form.getByLabel("收口结果").selectOption("achieved");
  await form.getByLabel("理解程度").fill("合成理解结果");
  await form.getByLabel("最小产出").fill("合成最小产出");
  await form.getByLabel("下一动作").fill("合成下一动作");
  const completion = form.getByRole("checkbox", { name: "同时完成任务" });
  if (await completion.count()) await completion.check();
  const mutation = await captureUiMutation(input.page, input.config, {
    method: "POST",
    path: `/api/study-sessions/${sessionId}/end`,
    expectedStatus: 200,
  }, () => form.getByRole("button", { name: "保存收口" }).click());
  const evidenceHeading = input.page.getByRole("heading", { name: "证据接力（可跳过）" });
  const lowConversion = input.page.getByRole("heading", { name: "低转化：先已保存 session" }).locator("..");
  await Promise.race([
    evidenceHeading.waitFor({ state: "visible" }),
    lowConversion.waitFor({ state: "visible" }),
  ]);
  if (await lowConversion.isVisible()) {
    await lowConversion.getByRole("button", { name: "跳过", exact: true }).click();
  }
  await evidenceHeading.waitFor({ state: "visible" });
  const after = await activeSessionOracle(input, "fixture-session-closed", false);
  assertOracleChanged(before, after);
  return {
    before,
    mutation,
    after,
    terminalAssertions: await terminalAssertions(input.page, [
      ["evidence-relay-visible", () => input.page.getByRole("heading", { name: "证据接力（可跳过）" }).isVisible()],
      ["session-status-ended", () => input.page.getByText("已结束", { exact: true }).first().isVisible()],
    ]),
  };
}

async function runReviewJourney(input: ScenarioContext) {
  const before = await captureOracle(input.context, input.config, "/api/reviews/today", (status, body) => [
    assertion("review-get-before-status", 200, status),
    assertion("review-absent-before", true, asRecord(body).review === null),
  ]);
  await input.page.getByPlaceholder("今天完成了什么").fill("合成复盘事实");
  await input.page.getByPlaceholder("今天最该保留的一个动作").fill("合成保留动作");
  await input.page.getByPlaceholder("明天最小必须完成任务").fill("合成明日行动");
  await input.page.getByLabel("情绪状态").selectOption({ label: "平静" });
  const mutation = await captureUiMutation(input.page, input.config, {
    method: "POST",
    path: "/api/daily-reviews",
    expectedStatus: 201,
  }, () => input.page.getByRole("button", { name: "保存复盘" }).click());
  await input.page.getByText(/复盘与明日最低行动已保存/).waitFor();
  const reviewId = stringField(asRecord(mutation.body).review, "id");
  const after = await captureOracle(input.context, input.config, "/api/reviews/today", (status, body) => [
    assertion("review-get-after-status", 200, status),
    assertion("review-created", true, Boolean(asRecord(body).review)),
    assertion("review-identity-matches", true, stringField(asRecord(body).review, "id") === reviewId),
  ]);
  assertOracleChanged(before, after);
  return {
    before,
    mutation,
    after,
    terminalAssertions: await terminalAssertions(input.page, [
      ["review-success-visible", () => input.page.getByText(/复盘与明日最低行动已保存/).isVisible()],
      ["review-success-live-region", () => input.page.locator('[aria-live="polite"]').filter({ hasText: "复盘" }).isVisible()],
    ]),
  };
}

async function runNotesJourney(input: ScenarioContext) {
  const before = await listOracle(input, "/api/notes", "notes", "notes-before", 0);
  await input.page.getByText("新增卡片", { exact: true }).click();
  await input.page.getByPlaceholder("笔记标题").fill("合成浏览器卡片");
  await input.page.getByPlaceholder("写下自己的理解、题解或复盘产出").fill("合成浏览器卡片正文");
  const mutation = await captureUiMutation(input.page, input.config, {
    method: "POST",
    path: "/api/notes",
    expectedStatus: 201,
  }, () => input.page.getByRole("button", { name: "保存笔记" }).click());
  const noteId = stringField(asRecord(mutation.body).note, "id");
  await input.page.getByText("合成浏览器卡片", { exact: true }).waitFor();
  const after = await captureOracle(input.context, input.config, "/api/notes", (status, body) => {
    const notes = arrayRecords(asRecord(body).notes);
    return [
      assertion("notes-after-status", 200, status),
      assertion("notes-count-after", 1, notes.length),
      assertion("created-note-present", true, notes.some((note) => note.id === noteId)),
    ];
  });
  assertOracleChanged(before, after);
  return {
    before,
    mutation,
    after,
    terminalAssertions: await terminalAssertions(input.page, [
      ["created-note-visible", () => input.page.getByText("合成浏览器卡片", { exact: true }).isVisible()],
      ["note-form-cleared", async () => await input.page.getByPlaceholder("笔记标题").inputValue() === ""],
    ]),
  };
}

async function runSyllabusJourney(input: ScenarioContext) {
  const before = await syllabusOracle(input, "syllabus-count-before", 1);
  await input.page.getByPlaceholder("章节、知识点或题型名称").fill("合成浏览器考纲节点");
  const mutation = await captureUiMutation(input.page, input.config, {
    method: "POST",
    path: "/api/syllabus/nodes",
    expectedStatus: 201,
  }, () => input.page.getByRole("button", { name: "写入考纲" }).click());
  const nodeId = stringField(asRecord(mutation.body).node, "id");
  const createdNode = input.page.getByText("合成浏览器考纲节点", { exact: true })
    .filter({ visible: true })
    .first();
  await createdNode.waitFor();
  const after = await captureOracle(input.context, input.config, "/api/syllabus", (status, body) => {
    const nodes = flattenSyllabusNodes(asRecord(body).nodes);
    return [
      assertion("syllabus-after-status", 200, status),
      assertion("syllabus-count-after", 2, nodes.length),
      assertion("created-syllabus-node-present", true, nodes.some((node) => node.id === nodeId)),
    ];
  });
  assertOracleChanged(before, after);
  return {
    before,
    mutation,
    after,
    terminalAssertions: await terminalAssertions(input.page, [
      ["created-node-visible", () => createdNode.isVisible()],
      ["syllabus-form-cleared", async () => await input.page.getByPlaceholder("章节、知识点或题型名称").inputValue() === ""],
    ]),
  };
}

async function runReportsJourney(input: ScenarioContext) {
  const path = "/api/reports/current?period=week";
  const before = await captureOracle(input.context, input.config, path, (status, body) => [
    assertion("report-before-status", 200, status),
    assertion("report-undecided-before", true, asRecord(asRecord(body).report).decision === null),
  ]);
  const mutation = await captureUiMutation(input.page, input.config, {
    method: "POST",
    path: /^\/api\/reports\/[^/]+\/confirm$/,
    expectedStatus: 201,
  }, () => input.page.getByRole("button", { name: "确认本报告" }).click());
  await input.page.getByText("已确认", { exact: true }).first().waitFor();
  const after = await captureOracle(input.context, input.config, path, (status, body) => {
    const decision = asRecord(asRecord(body).report).decision;
    return [
      assertion("report-after-status", 200, status),
      assertion("report-confirmed-after", "confirmed", stringField(decision, "status") ?? "missing"),
    ];
  });
  assertOracleChanged(before, after);
  return {
    before,
    mutation,
    after,
    terminalAssertions: await terminalAssertions(input.page, [
      ["report-confirmed-visible", () => input.page.getByText("已确认", { exact: true }).first().isVisible()],
      ["report-boundary-visible", () => input.page.getByText(/不会修改现有任务或当前阶段/).isVisible()],
    ]),
  };
}

async function runSimulationJourney(input: ScenarioContext) {
  const before = await listOracle(input, "/api/simulation/exams", "exams", "exams-before", 0);
  await input.page.getByLabel("名称").fill("合成浏览器模拟");
  const mutation = await captureUiMutation(input.page, input.config, {
    method: "POST",
    path: "/api/simulation/exams",
    expectedStatus: 201,
  }, () => input.page.getByRole("button", { name: "创建考试" }).click());
  const examId = stringField(asRecord(mutation.body).exam, "id");
  await input.page.waitForURL((url) => url.pathname.startsWith("/stage/simulation/"));
  const after = await captureOracle(input.context, input.config, "/api/simulation/exams", (status, body) => {
    const exams = arrayRecords(asRecord(body).exams);
    return [
      assertion("exams-after-status", 200, status),
      assertion("exams-count-after", 1, exams.length),
      assertion("created-exam-present", true, exams.some((exam) => exam.id === examId)),
    ];
  });
  assertOracleChanged(before, after);
  return {
    before,
    mutation,
    after,
    terminalAssertions: await terminalAssertions(input.page, [
      ["simulation-detail-route", () => Promise.resolve(currentPath(input.page).startsWith("/stage/simulation/"))],
      ["simulation-detail-heading", () => input.page.getByRole("heading", { level: 1 }).isVisible()],
    ]),
  };
}

async function runUpdateCenterJourney(input: ScenarioContext) {
  const path = "/api/system/update-status";
  const before = await captureOracle(input.context, input.config, path, (status, body) => [
    assertion("update-status-before", 200, status),
    assertion("queue-count-known-before", true, isNonNegativeInteger(asRecord(asRecord(body).status).requestQueueLength)),
  ]);
  const beforeQueue = numberField(asRecord(asRecord(before.body).status), "requestQueueLength");
  const mutation = await captureUiMutation(input.page, input.config, {
    method: "POST",
    path: "/api/system/update-requests",
    expectedStatus: 202,
  }, () => input.page.getByRole("button", { name: "检查更新" }).first().click());
  await input.page.getByText("已提交检查请求。", { exact: true }).waitFor();
  const after = await pollOracle(input.context, input.config, path, (status, body) => {
    const count = numberField(asRecord(asRecord(body).status), "requestQueueLength");
    return [
      assertion("update-status-after", 200, status),
      assertion("queue-count-increased", true, beforeQueue !== null && count !== null && count >= beforeQueue + 1),
    ];
  }, input.config.timeoutMs);
  assertOracleChanged(before, after);
  return {
    before,
    mutation,
    after,
    terminalAssertions: await terminalAssertions(input.page, [
      ["system-settings-route", () => Promise.resolve(currentPath(input.page) === "/settings/system")],
      ["version-center-visible", () => input.page.getByRole("heading", { name: "版本中心" }).isVisible()],
      ["check-request-notice-visible", () => input.page.getByText("已提交检查请求。", { exact: true }).isVisible()],
    ]),
  };
}

async function loginThroughUi(
  page: Page,
  config: BrowserEvidenceConfig,
  fixture: JourneyFixture,
  returnTo: string,
): Promise<MutationCapture> {
  const loginPath = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  await page.goto(new URL(loginPath, config.baseUrl).toString(), { waitUntil: "domcontentloaded" });
  await page.getByLabel("邮箱").fill(fixture.email);
  await page.getByLabel("密码").fill(config.password);
  const mutation = await captureUiMutation(page, config, {
    method: "POST",
    path: "/api/auth/login",
    expectedStatus: 200,
  }, () => page.getByRole("button", { name: "登录" }).click());
  const expected = new URL(returnTo, config.baseUrl).pathname;
  await page.waitForURL((url) => expected === "/today" ? url.pathname === expected : url.pathname === expected);
  return mutation;
}

async function captureUiMutation(
  page: Page,
  config: BrowserEvidenceConfig,
  expected: { method: "POST"; path: string | RegExp; expectedStatus: number },
  action: () => Promise<unknown>,
): Promise<MutationCapture> {
  let requestCount = 0;
  const countRequest = (request: { url(): string; method(): string }) => {
    const url = new URL(request.url());
    const pathMatches = typeof expected.path === "string" ? url.pathname === expected.path : expected.path.test(url.pathname);
    if (url.origin === config.baseUrl.origin && request.method() === expected.method && pathMatches) requestCount += 1;
  };
  page.on("request", countRequest);
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    const pathMatches = typeof expected.path === "string" ? url.pathname === expected.path : expected.path.test(url.pathname);
    return url.origin === config.baseUrl.origin && response.request().method() === expected.method && pathMatches;
  });
  try {
    const [response] = await Promise.all([responsePromise, action()]);
    await page.waitForTimeout(50);
    if (response.status() !== expected.expectedStatus) {
      throw new Error(`UI mutation returned unexpected HTTP status ${response.status()}`);
    }
    if (requestCount !== 1) throw new Error(`UI mutation emitted ${requestCount} matching requests instead of one`);
    const bytes = await response.body();
    return {
      evidence: {
        initiatedBy: "page-ui",
        uiOriginatedMutation: true,
        method: "POST",
        path: requestPath(response),
        status: response.status(),
        requestCount,
      },
      body: parseJson(bytes),
    };
  } finally {
    page.off("request", countRequest);
  }
}

async function captureOracle(
  context: BrowserContext,
  config: BrowserEvidenceConfig,
  oraclePath: string,
  assertions: (status: number, body: unknown) => V11Assertion[],
): Promise<OracleCapture> {
  const response = await context.request.get(new URL(oraclePath, config.baseUrl).toString(), {
    failOnStatusCode: false,
    timeout: config.timeoutMs,
    headers: { accept: "application/json" },
  });
  return oracleCapture(response, oraclePath, assertions);
}

async function pollOracle(
  context: BrowserContext,
  config: BrowserEvidenceConfig,
  oraclePath: string,
  assertions: (status: number, body: unknown) => V11Assertion[],
  timeoutMs: number,
): Promise<OracleCapture> {
  const deadline = Date.now() + timeoutMs;
  let latest: OracleCapture | null = null;
  do {
    latest = await captureOracle(context, config, oraclePath, assertions);
    if (latest.evidence.assertions.every((item) => item.passed)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return requiredFixtureValue(latest, "oracle poll result");
}

async function oracleCapture(
  response: APIResponse,
  oraclePath: string,
  buildAssertions: (status: number, body: unknown) => V11Assertion[],
): Promise<OracleCapture> {
  const bytes = await response.body();
  const body = parseJson(bytes);
  const checks = buildAssertions(response.status(), body);
  assertChecksPass(checks, `GET oracle ${oraclePath}`);
  return {
    path: oraclePath,
    evidence: {
      status: response.status(),
      responseSha256: sha256(bytes),
      assertions: checks,
    },
    body,
  };
}

async function activeSessionOracle(
  input: ScenarioContext,
  id: string,
  expectedPresent: boolean,
  expectedId?: string | null,
): Promise<OracleCapture> {
  return captureOracle(input.context, input.config, "/api/study-sessions/active", (status, body) => {
    const session = asRecord(body).session;
    return [
      assertion(`${id}-status`, 200, status),
      assertion(id, expectedPresent, session !== null && session !== undefined),
      ...(expectedId ? [assertion(`${id}-identity`, true, stringField(session, "id") === expectedId)] : []),
    ];
  });
}

async function listOracle(
  input: ScenarioContext,
  path: string,
  field: string,
  id: string,
  expectedCount: number,
): Promise<OracleCapture> {
  return captureOracle(input.context, input.config, path, (status, body) => [
    assertion(`${id}-status`, 200, status),
    assertion(id, expectedCount, arrayRecords(asRecord(body)[field]).length),
  ]);
}

async function syllabusOracle(input: ScenarioContext, id: string, expectedCount: number): Promise<OracleCapture> {
  return captureOracle(input.context, input.config, "/api/syllabus", (status, body) => [
    assertion(`${id}-status`, 200, status),
    assertion(id, expectedCount, flattenSyllabusNodes(asRecord(body).nodes).length),
  ]);
}

async function terminalAssertions(
  page: Page,
  checks: Array<[string, () => Promise<boolean>]>,
): Promise<V11Assertion[]> {
  const results: V11Assertion[] = [];
  for (const [id, check] of checks) results.push(assertion(id, true, await check()));
  assertChecksPass(results, `terminal state ${currentPath(page)}`);
  return results;
}

function assertion(
  id: string,
  expected: boolean | number | string,
  actual: boolean | number | string,
): V11Assertion {
  return { id, predicate: "equals", expected, actual, passed: Object.is(expected, actual) };
}

function assertChecksPass(assertions: V11Assertion[], scope: string): void {
  const failed = assertions.filter((item) => !item.passed);
  if (failed.length > 0) throw new Error(`${scope} failed ${failed.length} assertion(s)`);
}

function assertOracleChanged(before: OracleCapture, after: OracleCapture): void {
  if (before.path !== after.path) throw new Error("GET oracle path changed across the UI mutation");
  if (before.evidence.responseSha256 === after.evidence.responseSha256) {
    throw new Error("GET oracle response did not change across the UI mutation");
  }
}

function collectStrictTelemetry(page: Page) {
  let active = true;
  let consoleErrors = 0;
  let pageErrors = 0;
  let requestFailures = 0;
  let httpFailures = 0;
  const onConsole = (message: { type(): string }) => {
    if (active && message.type() === "error") consoleErrors += 1;
  };
  const onPageError = () => { if (active) pageErrors += 1; };
  const onRequestFailed = (request: Request) => {
    if (active && !isExpectedRscAbort(request)) requestFailures += 1;
  };
  const onResponse = (response: PlaywrightResponse) => {
    if (active && response.status() >= 400) httpFailures += 1;
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);
  return {
    assertEmpty() {
      const count = consoleErrors + pageErrors + requestFailures + httpFailures;
      if (count > 0) throw new Error(`browser telemetry contained ${count} unexplained failure(s)`);
    },
    stop() {
      active = false;
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("requestfailed", onRequestFailed);
      page.off("response", onResponse);
    },
  };
}

function isExpectedRscAbort(request: Request): boolean {
  const headers = request.headers();
  return request.failure()?.errorText === "net::ERR_ABORTED"
    && request.resourceType() === "fetch"
    && headers.rsc === "1";
}

function resolveStartPath(fixture: JourneyFixture): string {
  const configured = startPaths[fixture.journeyId];
  return configured.replace(":sessionId", fixture.activeSessionId ?? "missing");
}

function contractViewport(id: JourneyFixture["viewport"]): V11Viewport {
  const viewport = V11_VIEWPORT_CONTRACT[id];
  return { id, ...viewport };
}

function requestPath(response: PlaywrightResponse): string {
  const url = new URL(response.url());
  return `${url.pathname}${url.search}`;
}

function currentPath(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

export function canonicalEvidenceRoute(actual: string, template: string): string {
  const base = "http://areaforge.invalid";
  const actualUrl = new URL(actual, base);
  const templateUrl = new URL(template, base);
  const actualParts = actualUrl.pathname.split("/");
  const templateParts = templateUrl.pathname.split("/");
  if (actualParts.length !== templateParts.length) throw new Error("observed route does not match evidence contract shape");

  const normalizedParts = templateParts.map((part, index) => {
    const actualPart = actualParts[index];
    if (/^:[A-Za-z][A-Za-z0-9]*$/.test(part)) {
      if (!actualPart) throw new Error("observed route has an empty dynamic segment");
      return "synthetic-id";
    }
    if (actualPart !== part) throw new Error("observed route fixed segment does not match evidence contract");
    return part;
  });
  const actualQuery = [...actualUrl.searchParams.entries()].sort();
  const templateQuery = [...templateUrl.searchParams.entries()].sort();
  if (JSON.stringify(actualQuery) !== JSON.stringify(templateQuery)) {
    const actualKeys = actualQuery.map(([key]) => key);
    const templateKeys = templateQuery.map(([key]) => key);
    const mismatchedKeys = [...new Set([...actualKeys, ...templateKeys])].filter((key) =>
      JSON.stringify(actualUrl.searchParams.getAll(key)) !== JSON.stringify(templateUrl.searchParams.getAll(key)));
    throw new Error(
      `observed route query does not match evidence contract: actualKeys=${actualKeys.join(",") || "none"}; templateKeys=${templateKeys.join(",") || "none"}; mismatchedKeys=${mismatchedKeys.join(",") || "none"}`,
    );
  }
  return `${normalizedParts.join("/")}${templateUrl.search}`;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function flattenSyllabusNodes(value: unknown): Record<string, unknown>[] {
  return arrayRecords(value).flatMap((node) => [node, ...flattenSyllabusNodes(node.children)]);
}

function stringField(value: unknown, field: string): string | null {
  const candidate = asRecord(value)[field];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function numberField(value: unknown, field: string): number | null {
  const candidate = asRecord(value)[field];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function requiredFixtureValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined || value === "") throw new Error(`${label} is missing`);
  return value as T;
}
