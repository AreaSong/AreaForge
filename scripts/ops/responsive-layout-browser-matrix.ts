import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from "playwright-core";
import { CANONICAL_ROUTES } from "../../apps/web/lib/navigation/canonical-routes";
import {
  computeProductExperienceSourceHash,
  currentGitCommit,
} from "../quality/product-experience-source";
import {
  createG8ScreenshotEvidence,
  readG8PoolEvidenceFromEnvironment,
  type G8PoolEvidence,
} from "../quality/g8-browser-evidence-common";

const VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 1000 },
] as const;

const ZOOM_ROUTES = ["/focus", "/today", "/knowledge", "/roadmap/allocation", "/settings"] as const;

const DYNAMIC_FIXTURES: Readonly<Record<string, string>> = {
  "/roadmap/allocation/drafts/[itemId]": "/roadmap/allocation/drafts/test-inbox-open",
  "/roadmap/allocation/tasks/[taskId]": "/roadmap/allocation/tasks/test-task-today",
  "/roadmap/reviews/history/[decisionId]": "/roadmap/reviews/history/test-report-decision?period=week",
  "/test/retests/[retestId]": "/test/retests/test-knowledge-retest",
  "/test/simulations/[examId]": "/test/simulations/test-simulation",
  "/confirmations/[confirmationId]": "/confirmations/test-stage-draft-pending",
  "/knowledge/reviews/[scheduleId]/run": "/knowledge/reviews/test-review-schedule/run",
  "/knowledge/points/[pointId]": "/knowledge/points/test-kp-derivative",
  "/knowledge/imports/[importId]": "/knowledge/imports/test-import-batch",
  "/knowledge/syllabi/[nodeId]": "/knowledge/syllabi/test-node-derivative",
  "/knowledge/cards/[noteId]": "/knowledge/cards/test-note-limit",
  "/knowledge/mistakes/[mistakeId]": "/knowledge/mistakes/test-mistake-english",
  "/knowledge/resources/[resourceId]": "/knowledge/resources/test-resource-link",
  "/knowledge/resources/[resourceId]/preview": "/knowledge/resources/test-resource-link/preview",
  "/knowledge/reviews/[scheduleId]": "/knowledge/reviews/test-review-schedule",
};

interface TelemetryBucket {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  errorResponses: string[];
}

interface RouteResult {
  viewport: string;
  templatePath: string;
  concretePath: string;
  finalOrigin: string;
  finalPath: string;
  status: number | null;
  measurement: "measured" | "unmeasurable";
  mainVisible: boolean;
  innerWidth: number | null;
  innerHeight: number | null;
  rootOverflow: number | null;
  controlsWithinHorizontalBounds: boolean;
  documentTitle: string;
  mainTextLength: number;
  titleMatched: boolean;
  specialContract: "confirmation-window" | "link-preview-return" | null;
  contractVerified: boolean;
  windowOpened: boolean | null;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  errorResponses: string[];
  passed: boolean;
  failure: string | null;
}

interface ZoomResult {
  path: string;
  finalOrigin: string;
  finalPath: string;
  status: number | null;
  innerWidth: number;
  innerHeight: number;
  rootOverflow: number;
  controlsWithinHorizontalBounds: boolean;
  documentTitle: string;
  mainTextLength: number;
  titleMatched: boolean;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  errorResponses: string[];
  passed: boolean;
}

const root = process.cwd();
const baseUrl = normalizeLoopbackBaseUrl(process.env.AREAFORGE_RESPONSIVE_BASE_URL ?? process.argv[2]);
const runId = process.env.AREAFORGE_RESPONSIVE_RUN_ID ?? `responsive-g8-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const outputDirectory = resolveOutputDirectory(process.env.AREAFORGE_RESPONSIVE_OUTPUT_DIR ?? `output/playwright/${runId}`);

async function main(): Promise<void> {
  if (CANONICAL_ROUTES.length !== 49) throw new Error(`expected 49 canonical routes, found ${CANONICAL_ROUTES.length}`);
  assertDynamicFixturesComplete();
  if (existsSync(outputDirectory)) throw new Error(`refusing to overwrite existing output directory: ${outputDirectory}`);
  await mkdir(path.join(outputDirectory, "screenshots"), { recursive: true });

  const binding = {
    commit: currentGitCommit(root),
    sourceFingerprint: computeProductExperienceSourceHash(root),
  };
  const health = await readRuntimeHealth();
  assertRuntimeBinding(health, binding);

  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutablePath() });
  let routeResults: RouteResult[] = [];
  try {
    const nested: RouteResult[][] = [];
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport,
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      try {
        nested.push(await runViewport(browser, context, viewport));
      } finally {
        await context.close();
      }
    }
    routeResults = nested.flat();
  } finally {
    await browser.close();
  }

  const zoomEvidence = await runNativeZoomChecks();
  const completedBinding = {
    commit: currentGitCommit(root),
    sourceFingerprint: computeProductExperienceSourceHash(root),
  };
  const completedHealth = await readRuntimeHealth();
  assertRuntimeBinding(completedHealth, completedBinding);
  if (completedBinding.commit !== binding.commit || completedBinding.sourceFingerprint !== binding.sourceFingerprint) {
    throw new Error("source binding changed during responsive browser collection");
  }
  const failures = routeResults.filter((result) => !result.passed);
  const zoomFailures = zoomEvidence.results.filter((result) => !result.passed);
  const generatedAt = new Date().toISOString();
  const artifact = {
    schemaVersion: "responsive-layout-browser-matrix-v2",
    runId,
    generatedAt,
    environment: {
      baseUrl: baseUrl.origin,
      browser: "chromium",
      mode: "local-production-build",
      pool: readPoolBinding("AREAFORGE_RESPONSIVE", completedHealth),
    },
    binding: { ...completedBinding, capturePhase: "after-collection" as const },
    runtimeIdentity: completedHealth.runtimeIdentity,
    safety: {
      loopbackOnly: true,
      authentication: "local-demo-button",
      businessWrites: false,
      migration: false,
      productionTouched: false,
    },
    routes: CANONICAL_ROUTES.map((route) => ({
      templatePath: route.path,
      concretePath: concretePath(route.path),
      title: route.title,
    })),
    viewports: VIEWPORTS,
    zoom: zoomEvidence,
    summary: {
      routeCount: CANONICAL_ROUTES.length,
      viewportCount: VIEWPORTS.length,
      combinationCount: routeResults.length,
      passed: routeResults.length - failures.length,
      failed: failures.length,
      rootOverflowFailures: routeResults.filter((result) => result.rootOverflow !== null && result.rootOverflow > 1).length,
      unmeasurableRoutes: routeResults.filter((result) => result.measurement === "unmeasurable").length,
      consoleErrorCount: routeResults.reduce((total, result) => total + result.consoleErrors.length, 0),
      pageErrorCount: routeResults.reduce((total, result) => total + result.pageErrors.length, 0),
      failedRequestCount: routeResults.reduce((total, result) => total + result.failedRequests.length, 0),
      errorResponseCount: routeResults.reduce((total, result) => total + result.errorResponses.length, 0),
      zoomPassed: zoomEvidence.results.length - zoomFailures.length,
      zoomFailed: zoomFailures.length,
      result: failures.length === 0 && zoomFailures.length === 0 ? "PASS" : "FAIL",
    },
    results: routeResults,
    screenshotEvidence: [
      ...VIEWPORTS.map((viewport) => createG8ScreenshotEvidence(root, path.relative(root, path.join(outputDirectory, "screenshots", `today-${viewport.width}.png`)))),
      createG8ScreenshotEvidence(root, path.relative(root, path.join(outputDirectory, "screenshots", "today-native-zoom-125.png"))),
    ],
    doesNotProve: [
      "GitHub Release exists for this checkout",
      "production apply completed",
      "production health or production UX",
      "business mutation journeys",
    ],
  };
  const artifactPath = path.join(outputDirectory, "responsive-layout-browser-matrix.json");
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({
    runId,
    artifact: path.relative(root, artifactPath),
    screenshots: path.relative(root, path.join(outputDirectory, "screenshots")),
    ...artifact.summary,
  }, null, 2));
  if (artifact.summary.result !== "PASS") process.exitCode = 1;
}

async function runViewport(
  browser: Browser,
  authenticationContext: BrowserContext,
  viewport: (typeof VIEWPORTS)[number],
): Promise<RouteResult[]> {
  const label = `${viewport.width}x${viewport.height}`;
  const publicResults: RouteResult[] = [];
  const publicContext = await browser.newContext(browserContextOptions(viewport));
  try {
    for (const route of CANONICAL_ROUTES.filter((candidate) => candidate.shell === "public")) {
      publicResults.push(await inspectRouteInNewPage(publicContext, label, route.path, concretePath(route.path), true));
    }
  } finally {
    await publicContext.close();
  }
  const authenticationPage = await authenticationContext.newPage();
  configurePage(authenticationPage);
  await authenticateWithDemoButton(authenticationPage);
  await waitForStablePage(authenticationPage);
  const storageState = await authenticationContext.storageState();
  await authenticationPage.close();
  const appResults: RouteResult[] = [];
  const appContext = await browser.newContext({ ...browserContextOptions(viewport), storageState });
  try {
    for (const route of CANONICAL_ROUTES.filter((candidate) => candidate.shell === "app")) {
      const concrete = concretePath(route.path);
      appResults.push(await inspectRouteInNewPage(
        appContext,
        label,
        route.path,
        concrete,
        false,
        route.path === "/today" ? path.join(outputDirectory, "screenshots", `today-${viewport.width}.png`) : undefined,
      ));
    }
  } finally {
    await appContext.close();
  }
  return [...publicResults, ...appResults];
}

function browserContextOptions(viewport: (typeof VIEWPORTS)[number]) {
  return {
    viewport,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "dark" as const,
    reducedMotion: "reduce" as const,
  };
}

async function inspectRouteInNewPage(
  context: BrowserContext,
  viewport: string,
  templatePath: string,
  targetPath: string,
  publicRoute: boolean,
  screenshotPath?: string,
): Promise<RouteResult> {
  const page = await context.newPage();
  configurePage(page);
  const telemetry = attachTelemetry(page, templatePath);
  try {
    const result = await inspectRoute(page, telemetry, viewport, templatePath, targetPath, publicRoute);
    if (screenshotPath && result.measurement === "measured") {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    return result;
  } finally {
    await page.close();
  }
}

async function inspectRoute(
  page: Page,
  telemetry: TelemetryBucket,
  viewport: string,
  templatePath: string,
  targetPath: string,
  publicRoute: boolean,
): Promise<RouteResult> {
  let response: Response | null = null;
  let failure: string | null = null;
  let navigationCompleted = false;
  let navigationError: unknown = null;
  page.on("response", (candidate) => {
    const request = candidate.request();
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
    if (new URL(candidate.url()).pathname === new URL(targetPath, baseUrl).pathname) response = candidate;
  });
  try {
    try {
      response = await page.goto(new URL(targetPath, baseUrl).toString(), { waitUntil: "domcontentloaded" }) ?? response;
    } catch (error) {
      navigationError = error;
    }
    await waitForRouteContract(page, templatePath, targetPath);
    await page.locator("main").first().waitFor({ state: "visible" });
    await waitForStablePage(page);
    if (navigationError && !isExpectedTransitionFinalPath(page, templatePath, targetPath)) throw navigationError;
    navigationCompleted = true;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
    const expectedTitle = templatePath.startsWith("/confirmations")
      || templatePath === "/knowledge/resources/[resourceId]/preview"
      || templatePath === "/knowledge/reviews/[scheduleId]/run"
      ? ""
      : CANONICAL_ROUTES.find((route) => route.path === templatePath)?.title ?? "";
    const metrics = navigationCompleted ? await page.evaluate((title) => {
      const main = document.querySelector("main");
      const rect = main?.getBoundingClientRect();
      const controls = Array.from(document.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')).filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
      return {
        mainVisible: Boolean(rect && rect.width > 0 && rect.height > 0),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        rootOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        controlsWithinHorizontalBounds: controls.every((element) => {
          let scrollContainer: HTMLElement | null = element.parentElement;
          while (scrollContainer && scrollContainer !== document.body) {
            if (["auto", "scroll"].includes(getComputedStyle(scrollContainer).overflowX)) return true;
            scrollContainer = scrollContainer.parentElement;
          }
          const bounds = element.getBoundingClientRect();
          return bounds.left >= -1 && bounds.right <= window.innerWidth + 1;
        }),
        documentTitle: document.title,
        mainTextLength: main?.textContent?.trim().length ?? 0,
        titleMatched: title.length === 0 || document.title.includes(title),
        windowOpened: Boolean(document.querySelector('[data-layout-region="global-window-portal"] [role="dialog"][aria-label="确认中心"]')?.getClientRects().length),
      };
    }, expectedTitle).then((value) => ({ measurement: "measured" as const, ...value })).catch(() => ({
      measurement: "unmeasurable" as const,
      mainVisible: false,
      innerWidth: null,
      innerHeight: null,
      rootOverflow: null,
      controlsWithinHorizontalBounds: false,
      documentTitle: "",
      mainTextLength: 0,
      titleMatched: false,
      windowOpened: null,
  })) : { measurement: "unmeasurable" as const, mainVisible: false, innerWidth: null, innerHeight: null, rootOverflow: null, controlsWithinHorizontalBounds: false, documentTitle: "", mainTextLength: 0, titleMatched: false, windowOpened: null };
  const finalPath = `${new URL(page.url()).pathname}${new URL(page.url()).search}`;
  const pathContract = routePathContract(page, templatePath, targetPath, publicRoute, metrics.windowOpened);
  const telemetrySnapshot = snapshotTelemetry(telemetry);
  const status = response?.status() ?? null;
  const passed = failure === null
    && status !== null && status < 400
    && metrics.measurement === "measured"
    && metrics.mainVisible
    && metrics.rootOverflow !== null && metrics.rootOverflow <= 1
    && metrics.controlsWithinHorizontalBounds
    && metrics.mainTextLength > 0
    && metrics.titleMatched
    && pathContract.pathMatched
    && pathContract.contractVerified
    && issueCount(telemetrySnapshot) === 0;
  return {
    viewport,
    templatePath,
    concretePath: targetPath,
    finalOrigin: new URL(page.url()).origin,
    finalPath,
    status,
    ...metrics,
    windowOpened: templatePath.startsWith("/confirmations") ? metrics.windowOpened : null,
    specialContract: pathContract.specialContract,
    contractVerified: pathContract.contractVerified,
    ...telemetrySnapshot,
    passed,
    failure,
  };
}

function isExpectedTransitionFinalPath(page: Page, templatePath: string, targetPath: string): boolean {
  const finalPath = new URL(page.url()).pathname;
  if (templatePath.startsWith("/confirmations")) return finalPath === "/today";
  if (templatePath === "/knowledge/resources/[resourceId]/preview") {
    return finalPath === new URL(targetPath, baseUrl).pathname.replace(/\/preview$/, "");
  }
  return templatePath === "/knowledge/reviews/[scheduleId]/run" && finalPath === "/focus";
}

async function waitForRouteContract(page: Page, templatePath: string, targetPath: string): Promise<void> {
  if (templatePath.startsWith("/confirmations")) {
    await page.waitForURL((candidate) => candidate.pathname === "/today");
    await page.locator('[data-layout-region="global-window-portal"] [role="dialog"][aria-label="确认中心"]').waitFor({ state: "visible" });
    return;
  }
  if (templatePath === "/knowledge/resources/[resourceId]/preview") {
    const detailPath = new URL(targetPath, baseUrl).pathname.replace(/\/preview$/, "");
    await page.waitForURL((candidate) => candidate.pathname === detailPath);
  }
}

function routePathContract(
  page: Page,
  templatePath: string,
  targetPath: string,
  publicRoute: boolean,
  windowOpened: boolean | null,
): { pathMatched: boolean; specialContract: RouteResult["specialContract"]; contractVerified: boolean } {
  const finalPath = new URL(page.url()).pathname;
  if (templatePath.startsWith("/confirmations")) {
    const matched = finalPath === "/today";
    return { pathMatched: matched, specialContract: "confirmation-window", contractVerified: matched && windowOpened === true };
  }
  if (templatePath === "/knowledge/resources/[resourceId]/preview") {
    const detailPath = new URL(targetPath, baseUrl).pathname.replace(/\/preview$/, "");
    const matched = finalPath === detailPath;
    return { pathMatched: matched, specialContract: "link-preview-return", contractVerified: matched };
  }
  if (publicRoute) {
    const matched = templatePath === "/login" ? finalPath === "/login" : ["/", "/login"].includes(finalPath);
    return { pathMatched: matched, specialContract: null, contractVerified: true };
  }
  const expectedPath = new URL(targetPath, baseUrl).pathname;
  const quickReviewMatched = templatePath === "/knowledge/reviews/[scheduleId]/run" && finalPath === "/focus";
  return { pathMatched: finalPath === expectedPath || quickReviewMatched, specialContract: null, contractVerified: true };
}

async function runNativeZoomChecks(): Promise<{
  requested: "125%";
  mechanism: "Chrome default zoom";
  baseline: { innerWidth: number; devicePixelRatio: number };
  zoomed: { innerWidth: number; devicePixelRatio: number };
  selectedValue: string;
  results: ZoomResult[];
}> {
  const profile = await mkdtemp(path.join(tmpdir(), "areaforge-responsive-zoom-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    executablePath: chromeExecutablePath(),
    viewport: null,
    args: ["--window-size=1440,1000", "--no-first-run", "--no-default-browser-check"],
  });
  try {
    const page = context.pages().find((candidate) => !candidate.url().startsWith("chrome://")) ?? await context.newPage();
    configurePage(page);
    await setChromeDefaultZoom(context, 1);
    await authenticateWithDemoButton(page);
    await waitForStablePage(page);
    const baseline = await windowMetrics(page);
    const selectedValue = await setChromeDefaultZoom(context, 1.25);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForStablePage(page);
    const zoomed = await windowMetrics(page);
    await page.close();
    const results: ZoomResult[] = [];
    for (const route of ZOOM_ROUTES) {
      const routePage = await context.newPage();
      configurePage(routePage);
      const bucket = attachTelemetry(routePage);
      try {
        const response = await routePage.goto(new URL(route, baseUrl).toString(), { waitUntil: "domcontentloaded" });
        await routePage.locator("main").first().waitFor({ state: "visible" });
        await waitForStablePage(routePage);
        const metrics = await reflowMetrics(routePage);
        const finalPath = new URL(routePage.url()).pathname;
        const telemetrySnapshot = snapshotTelemetry(bucket);
        results.push({
          path: route,
          finalOrigin: new URL(routePage.url()).origin,
          finalPath,
          status: response?.status() ?? null,
          ...metrics,
          ...telemetrySnapshot,
          passed: finalPath === route
            && (response?.status() ?? 500) < 400
            && metrics.rootOverflow <= 1
            && metrics.controlsWithinHorizontalBounds
            && issueCount(telemetrySnapshot) === 0,
        });
        if (route === "/today") {
          await routePage.screenshot({ path: path.join(outputDirectory, "screenshots", "today-native-zoom-125.png"), fullPage: true });
        }
      } finally {
        await routePage.close();
      }
    }
    return { requested: "125%", mechanism: "Chrome default zoom", baseline, zoomed, selectedValue, results };
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
}

async function authenticateWithDemoButton(page: Page): Promise<void> {
  await page.goto(new URL("/login", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "填入本地演示账号" }).click();
  await page.getByRole("button", { name: "登录并继续学习" }).click();
  await page.waitForURL((candidate) => candidate.pathname === "/today");
}

function attachTelemetry(page: Page, templatePath?: string): TelemetryBucket {
  const telemetry = emptyTelemetry();
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") telemetry.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => telemetry.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (!isExpectedCancellation(request, templatePath)) {
      telemetry.failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) telemetry.errorResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return telemetry;
}

function emptyTelemetry(): TelemetryBucket {
  return { consoleErrors: [], pageErrors: [], failedRequests: [], errorResponses: [] };
}

function snapshotTelemetry(telemetry: TelemetryBucket): TelemetryBucket {
  return {
    consoleErrors: [...telemetry.consoleErrors],
    pageErrors: [...telemetry.pageErrors],
    failedRequests: [...telemetry.failedRequests],
    errorResponses: [...telemetry.errorResponses],
  };
}

function isExpectedCancellation(request: Request, templatePath?: string): boolean {
  const failure = request.failure()?.errorText ?? "";
  const explicitlyCanceled = failure.includes("ERR_ABORTED") || failure.includes("NS_BINDING_ABORTED");
  if (!explicitlyCanceled) return false;
  const headers = request.headers();
  const candidate = new URL(request.url());
  const rsc = request.resourceType() === "fetch" && (headers.rsc === "1" || candidate.searchParams.has("_rsc"));
  if (rsc) return true;
  return templatePath?.startsWith("/confirmations") === true
    && request.method() === "GET"
    && candidate.origin === baseUrl.origin
    && candidate.pathname === "/api/confirmations";
}

function configurePage(page: Page): void {
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
}

async function waitForStablePage(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 500 }).catch(() => undefined);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function setChromeDefaultZoom(context: BrowserContext, zoom: 1 | 1.25): Promise<string> {
  const settings = await context.newPage();
  try {
    await settings.goto("chrome://settings/appearance", { waitUntil: "domcontentloaded" });
    const select = settings.locator("select#zoomLevel");
    await select.waitFor();
    await select.selectOption(String(zoom));
    await select.waitFor({ state: "visible" });
    return await select.inputValue();
  } finally {
    await settings.close();
  }
}

async function windowMetrics(page: Page): Promise<{ innerWidth: number; devicePixelRatio: number }> {
  return page.evaluate(() => ({ innerWidth: window.innerWidth, devicePixelRatio: window.devicePixelRatio }));
}

async function reflowMetrics(page: Page): Promise<{
  innerWidth: number;
  innerHeight: number;
  rootOverflow: number;
  controlsWithinHorizontalBounds: boolean;
  documentTitle: string;
  mainTextLength: number;
  titleMatched: boolean;
}> {
  return page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])',
    )).filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
    const tolerance = 1;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      rootOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      controlsWithinHorizontalBounds: controls.every((element) => {
        let scrollContainer: HTMLElement | null = element.parentElement;
        while (scrollContainer && scrollContainer !== document.body) {
          if (["auto", "scroll"].includes(getComputedStyle(scrollContainer).overflowX)) return true;
          scrollContainer = scrollContainer.parentElement;
        }
        const rect = element.getBoundingClientRect();
        return rect.left >= -tolerance && rect.right <= window.innerWidth + tolerance;
      }),
      documentTitle: document.title,
      mainTextLength: document.querySelector("main")?.textContent?.trim().length ?? 0,
      titleMatched: document.title.length > 0,
    };
  });
}

function concretePath(templatePath: string): string {
  if (!templatePath.includes("[")) return templatePath;
  const fixture = DYNAMIC_FIXTURES[templatePath];
  if (!fixture) throw new Error(`missing concrete fixture for ${templatePath}`);
  return fixture;
}

function assertDynamicFixturesComplete(): void {
  const templates = CANONICAL_ROUTES.filter((route) => route.path.includes("[")).map((route) => route.path).sort();
  const fixtures = Object.keys(DYNAMIC_FIXTURES).sort();
  if (JSON.stringify(templates) !== JSON.stringify(fixtures)) {
    throw new Error(`dynamic fixture map drift: templates=${templates.join(",")} fixtures=${fixtures.join(",")}`);
  }
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
  if (!value) throw new Error("usage: pnpm ops:responsive-layout:browser-matrix <latest-loopback-url>");
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("responsive browser matrix only accepts an HTTP loopback URL");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function resolveOutputDirectory(relative: string): string {
  if (path.isAbsolute(relative) || !relative.startsWith("output/playwright/") || relative.includes("..")) {
    throw new Error("responsive output directory must be a new repo-relative path under output/playwright/");
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

function readPoolBinding(prefix: string, _health: unknown): G8PoolEvidence {
  return readG8PoolEvidenceFromEnvironment(prefix, baseUrl.origin);
}

function issueCount(bucket: TelemetryBucket): number {
  return bucket.consoleErrors.length + bucket.pageErrors.length + bucket.failedRequests.length + bucket.errorResponses.length;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
