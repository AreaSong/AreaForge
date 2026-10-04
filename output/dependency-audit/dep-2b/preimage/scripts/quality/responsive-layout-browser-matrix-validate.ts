import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  RESPONSIVE_DOES_NOT_PROVE,
  RESPONSIVE_ROUTES,
  RESPONSIVE_SCHEMA,
  RESPONSIVE_VIEWPORTS,
  addIssue,
  buildExpectedBinding,
  deriveResult,
  exactKeys,
  expectedFinalPath,
  finishResult,
  isRecord,
  isSafeRoute,
  issueCount,
  readG8JsonFile,
  readG8Screenshot,
  rereadUnchanged,
  requireInteger,
  validateArtifactBinding,
  validateCommonBinding,
  validateDoesNotProve,
  validateEvidenceTimestamp,
  validateEnvironment,
  validateExpectedScreenshotDirectory,
  validateRunIdentity,
  validateSafety,
  type G8EvidenceBinding,
  type G8ScreenshotEvidence,
  type G8ValidationIssue,
  type G8ValidationResult,
} from "./g8-browser-evidence-common";
import { safeV11Error } from "./v11-browser-evidence-contract";
import {
  computeProductExperienceSourceHash,
  currentGitCommit,
  findWorkspaceRoot,
} from "./product-experience-source";

type JsonRecord = Record<string, unknown>;

const TOP_KEYS = [
  "schemaVersion", "runId", "generatedAt", "environment", "binding", "runtimeIdentity", "safety",
  "routes", "viewports", "zoom", "summary", "results", "screenshotEvidence", "doesNotProve",
] as const;
const ROUTE_KEYS = ["templatePath", "concretePath", "title"] as const;
const VIEWPORT_KEYS = ["width", "height"] as const;
const RESULT_KEYS = [
  "viewport", "templatePath", "concretePath", "finalOrigin", "finalPath", "status", "measurement", "mainVisible",
  "innerWidth", "innerHeight", "rootOverflow", "controlsWithinHorizontalBounds", "documentTitle", "mainTextLength", "titleMatched",
  "specialContract", "contractVerified", "windowOpened", "consoleErrors", "pageErrors", "failedRequests", "errorResponses", "passed", "failure",
] as const;
const ZOOM_KEYS = ["requested", "mechanism", "baseline", "zoomed", "selectedValue", "results"] as const;
const ZOOM_METRICS_KEYS = ["innerWidth", "devicePixelRatio"] as const;
const ZOOM_RESULT_KEYS = [
  "path", "finalOrigin", "finalPath", "status", "innerWidth", "innerHeight", "rootOverflow", "controlsWithinHorizontalBounds",
  "documentTitle", "mainTextLength", "titleMatched", "consoleErrors", "pageErrors", "failedRequests", "errorResponses", "passed",
] as const;
const SUMMARY_KEYS = [
  "routeCount", "viewportCount", "combinationCount", "passed", "failed", "rootOverflowFailures",
  "unmeasurableRoutes", "consoleErrorCount", "pageErrorCount", "failedRequestCount", "errorResponseCount",
  "zoomPassed", "zoomFailed", "result",
] as const;
const TELEMETRY_KEYS = ["consoleErrors", "pageErrors", "failedRequests", "errorResponses"] as const;
const EXPECTED_SAFETY = {
  loopbackOnly: true,
  authentication: "local-demo-button",
  businessWrites: false,
  migration: false,
  productionTouched: false,
} as const;
const ZOOM_PATHS = ["/focus", "/today", "/knowledge", "/roadmap/allocation", "/settings"] as const;

export type ResponsiveLayoutBrowserMatrixValidationResult = G8ValidationResult;

export function validateResponsiveLayoutBrowserMatrix(
  value: unknown,
  binding: G8EvidenceBinding,
): ResponsiveLayoutBrowserMatrixValidationResult {
  const issues: G8ValidationIssue[] = [];
  const screenshots: G8ScreenshotEvidence[] = [];
  if (!isRecord(value)) return finishResult(null, 0, [{ field: "record", message: "must be a JSON object" }]);
  if (value.schemaVersion !== RESPONSIVE_SCHEMA) {
    addIssue(issues, "schemaVersion", `must be ${RESPONSIVE_SCHEMA}`);
    return finishResult(null, 0, issues);
  }
  exactKeys(value, TOP_KEYS, "record", issues);
  validateRunIdentity(value.runId, "responsive-g8-", issues);
  const generatedAt = validateEvidenceTimestamp(value.generatedAt, binding, issues);
  const identity = validateCommonBinding(value, binding, issues, generatedAt);
  validateEnvironment(value.environment, identity, generatedAt, issues);
  if (!identity) validateArtifactBinding(value.binding, binding, null, issues);
  validateSafety(value.safety, EXPECTED_SAFETY, issues);
  validateDoesNotProve(value.doesNotProve, RESPONSIVE_DOES_NOT_PROVE, issues);

  validateRoutes(value.routes, issues);
  validateViewports(value.viewports, issues);
  const routeResults = validateRouteResults(value.results, issues);
  validateZoom(value.zoom, screenshots, value.runId, binding.root, issues);
  validateSummary(value.summary, routeResults, value.zoom, issues);

  if (typeof value.runId === "string") {
    validateExpectedScreenshotDirectory(binding.root, value.runId, responsiveScreenshotNames(), issues);
  }
  validateScreenshotDeclarations(value.screenshotEvidence, screenshots, binding.root, value.runId, value.zoom, issues);
  if (routeResults.length === 343 && routeResults.some((item) => item.passed !== true)) {
    addIssue(issues, "results", "every route/viewport combination must pass");
  }
  return finishResult(RESPONSIVE_SCHEMA, Array.isArray(value.results) ? value.results.length : 0, issues, screenshots);
}

export function validateResponsiveLayoutBrowserMatrixFile(
  evidencePath: string,
  binding: G8EvidenceBinding,
): ResponsiveLayoutBrowserMatrixValidationResult {
  const loaded = readG8JsonFile(binding.root, evidencePath);
  if (!loaded.file || !loaded.file.value) {
    return finishResult(null, 0, loaded.issues);
  }
  const result = validateResponsiveLayoutBrowserMatrix(loaded.file.value, binding);
  const issues = [...loaded.issues, ...result.issues];
  rereadUnchanged(binding.root, loaded.file.relativePath, loaded.file.sha256, issues);
  return finishResult(result.schemaVersion, result.itemCount, issues, result.screenshots);
}

function validateRoutes(raw: unknown, issues: G8ValidationIssue[]): void {
  if (!Array.isArray(raw)) {
    addIssue(issues, "routes", "must contain exactly 49 route definitions");
    return;
  }
  if (raw.length !== RESPONSIVE_ROUTES.length) addIssue(issues, "routes", "must contain exactly 49 route definitions");
  raw.slice(0, 100).forEach((entry, index) => {
    const field = `routes[${index}]`;
    if (!isRecord(entry)) {
      addIssue(issues, field, "must be an object");
      return;
    }
    exactKeys(entry, ROUTE_KEYS, field, issues);
    const expected = RESPONSIVE_ROUTES[index];
    if (!expected) {
      addIssue(issues, field, "contains an unexpected route");
      return;
    }
    if (entry.templatePath !== expected[0]) addIssue(issues, `${field}.templatePath`, "must use canonical route order");
    if (entry.concretePath !== expected[1]) addIssue(issues, `${field}.concretePath`, "must use the fixed synthetic fixture path");
    if (entry.title !== expected[2]) addIssue(issues, `${field}.title`, "must match the canonical route title");
    if (!isSafeRoute(entry.concretePath)) addIssue(issues, `${field}.concretePath`, "must be a redacted same-origin route");
  });
}

function validateViewports(raw: unknown, issues: G8ValidationIssue[]): void {
  if (!Array.isArray(raw)) {
    addIssue(issues, "viewports", "must contain exactly 7 viewports");
    return;
  }
  if (raw.length !== RESPONSIVE_VIEWPORTS.length) addIssue(issues, "viewports", "must contain exactly 7 viewports");
  raw.slice(0, 100).forEach((entry, index) => {
    const field = `viewports[${index}]`;
    if (!isRecord(entry)) {
      addIssue(issues, field, "must be an object");
      return;
    }
    exactKeys(entry, VIEWPORT_KEYS, field, issues);
    const expected = RESPONSIVE_VIEWPORTS[index];
    if (!expected) return;
    if (entry.width !== expected.width || entry.height !== expected.height) addIssue(issues, field, "must match the fixed seven-viewport contract");
  });
}

function validateRouteResults(raw: unknown, issues: G8ValidationIssue[]): JsonRecord[] {
  if (!Array.isArray(raw)) {
    addIssue(issues, "results", "must contain exactly 343 route/viewport combinations");
    return [];
  }
  if (raw.length !== RESPONSIVE_ROUTES.length * RESPONSIVE_VIEWPORTS.length) addIssue(issues, "results", "must contain exactly 343 route/viewport combinations");
  const rows: JsonRecord[] = [];
  raw.slice(0, 400).forEach((entry, index) => {
    const field = `results[${index}]`;
    if (!isRecord(entry)) {
      addIssue(issues, field, "must be an object");
      return;
    }
    rows.push(entry);
    exactKeys(entry, RESULT_KEYS, field, issues);
    const viewportIndex = Math.floor(index / RESPONSIVE_ROUTES.length);
    const routeIndex = index % RESPONSIVE_ROUTES.length;
    const viewport = RESPONSIVE_VIEWPORTS[viewportIndex];
    const route = RESPONSIVE_ROUTES[routeIndex];
    if (!viewport || !route) {
      addIssue(issues, field, "contains an unexpected combination");
      return;
    }
    const viewportLabel = `${viewport.width}x${viewport.height}`;
    if (entry.viewport !== viewportLabel) addIssue(issues, `${field}.viewport`, "must use canonical viewport order");
    if (entry.templatePath !== route[0]) addIssue(issues, `${field}.templatePath`, "must use canonical route order");
    if (entry.concretePath !== route[1]) addIssue(issues, `${field}.concretePath`, "must match the route fixture");
    if (!isLoopbackOrigin(entry.finalOrigin)) addIssue(issues, `${field}.finalOrigin`, "must be the loopback test-pool origin");
    if (!isSafeRoute(entry.finalPath)) addIssue(issues, `${field}.finalPath`, "must be a redacted same-origin route");
    else if (!matchesExpectedFinalPath(String(entry.finalPath), route[0], route[1], route[0] === "/" || route[0] === "/login")) {
      addIssue(issues, `${field}.finalPath`, "does not satisfy the route transition contract");
    }
    if (typeof entry.status !== "number" || !Number.isInteger(entry.status) || entry.status < 200 || entry.status >= 400) addIssue(issues, `${field}.status`, "must be a successful HTTP status");
    if (entry.measurement !== "measured") addIssue(issues, `${field}.measurement`, "must be measured");
    if (entry.mainVisible !== true) addIssue(issues, `${field}.mainVisible`, "must be true");
    if (entry.innerWidth !== viewport.width || entry.innerHeight !== viewport.height) addIssue(issues, `${field}.viewportMetrics`, "must match the requested viewport dimensions");
    if (!requireInteger(entry.rootOverflow, `${field}.rootOverflow`, issues, 0, 10_000) || Number(entry.rootOverflow) > 1) addIssue(issues, `${field}.rootOverflow`, "must be at most 1 CSS pixel");
    if (entry.controlsWithinHorizontalBounds !== true) addIssue(issues, `${field}.controlsWithinHorizontalBounds`, "must be true");
    if (typeof entry.documentTitle !== "string" || entry.documentTitle.trim().length < 1) addIssue(issues, `${field}.documentTitle`, "must be a non-empty document title");
    if (!requireInteger(entry.mainTextLength, `${field}.mainTextLength`, issues, 1, 1_000_000)) addIssue(issues, `${field}.mainTextLength`, "must contain a visible route content signal");
    if (entry.titleMatched !== true) addIssue(issues, `${field}.titleMatched`, "must match the route-specific title oracle");
    const expectedSpecial = route[0].startsWith("/confirmations") ? "confirmation-window" : route[0] === "/knowledge/resources/[resourceId]/preview" ? "link-preview-return" : null;
    if (entry.specialContract !== expectedSpecial) addIssue(issues, `${field}.specialContract`, "must match the fixed route special contract");
    if (entry.contractVerified !== true) addIssue(issues, `${field}.contractVerified`, "must be true");
    const expectedWindow = route[0].startsWith("/confirmations") ? true : null;
    if (entry.windowOpened !== expectedWindow) addIssue(issues, `${field}.windowOpened`, "must match the confirmation window contract");
    validateTelemetry(entry, field, issues);
    if (entry.failure !== null) addIssue(issues, `${field}.failure`, "must be null for admissible evidence");
    if (entry.passed !== true || !deriveResult(entry, TELEMETRY_KEYS)) addIssue(issues, `${field}.passed`, "must be true and derivable from the observed fields");
  });
  return rows;
}

function validateTelemetry(entry: JsonRecord, field: string, issues: G8ValidationIssue[]): void {
  for (const key of TELEMETRY_KEYS) {
    if (!Array.isArray(entry[key]) || entry[key].length !== 0) addIssue(issues, `${field}.${key}`, "must be an empty array (telemetry must be zero)");
  }
}

function matchesExpectedFinalPath(finalPath: string, templatePath: string, concretePath: string, publicRoute: boolean): boolean {
  const expected = expectedFinalPath(templatePath, concretePath, publicRoute);
  if (!expected) return false;
  try {
    const actualUrl = new URL(finalPath, "http://areaforge.invalid");
    if (templatePath === "/knowledge/reviews/[scheduleId]/run") {
      const concreteUrl = new URL(concretePath, "http://areaforge.invalid");
      const fallbackUrl = new URL("/focus?returnTo=%2Ftoday", "http://areaforge.invalid");
      return (
        (actualUrl.pathname === concreteUrl.pathname && actualUrl.search === concreteUrl.search) ||
        (actualUrl.pathname === fallbackUrl.pathname && actualUrl.search === fallbackUrl.search)
      );
    }
    const expectedUrl = new URL(expected, "http://areaforge.invalid");
    if (actualUrl.pathname !== expectedUrl.pathname) return false;
    return actualUrl.search === expectedUrl.search;
  } catch { return false; }
}

function validateZoom(raw: unknown, screenshots: G8ScreenshotEvidence[], runId: unknown, root: string, issues: G8ValidationIssue[]): void {
  if (!isRecord(raw)) {
    addIssue(issues, "zoom", "must be an object");
    return;
  }
  exactKeys(raw, ZOOM_KEYS, "zoom", issues);
  if (raw.requested !== "125%") addIssue(issues, "zoom.requested", "must be 125%");
  if (raw.mechanism !== "Chrome default zoom") addIssue(issues, "zoom.mechanism", "must identify Chrome default zoom");
  validateZoomMetrics(raw.baseline, "zoom.baseline", issues);
  validateZoomMetrics(raw.zoomed, "zoom.zoomed", issues);
  if (raw.selectedValue !== "1.25") addIssue(issues, "zoom.selectedValue", "must be 1.25");
  if (isRecord(raw.baseline) && isRecord(raw.zoomed)) {
    if (Number(raw.zoomed.innerWidth) >= Number(raw.baseline.innerWidth)) addIssue(issues, "zoom.zoomed.innerWidth", "must be narrower than baseline at 125% zoom");
  }
  if (!Array.isArray(raw.results)) {
    addIssue(issues, "zoom.results", "must contain exactly 5 routes");
    return;
  }
  if (raw.results.length !== ZOOM_PATHS.length) addIssue(issues, "zoom.results", "must contain exactly 5 routes");
  raw.results.slice(0, 20).forEach((entry, index) => {
    const field = `zoom.results[${index}]`;
    if (!isRecord(entry)) {
      addIssue(issues, field, "must be an object");
      return;
    }
    exactKeys(entry, ZOOM_RESULT_KEYS, field, issues);
    const expectedPath = ZOOM_PATHS[index];
    if (entry.path !== expectedPath) addIssue(issues, `${field}.path`, "must use canonical zoom route order");
    if (entry.finalPath !== expectedPath) addIssue(issues, `${field}.finalPath`, "must remain on the requested route");
    if (!isLoopbackOrigin(entry.finalOrigin)) addIssue(issues, `${field}.finalOrigin`, "must be the loopback test-pool origin");
    if (typeof entry.status !== "number" || !Number.isInteger(entry.status) || entry.status < 200 || entry.status >= 400) addIssue(issues, `${field}.status`, "must be a successful HTTP status");
    for (const key of ["innerWidth", "innerHeight"] as const) requireInteger(entry[key], `${field}.${key}`, issues, 1, 20_000);
    if (!requireInteger(entry.rootOverflow, `${field}.rootOverflow`, issues, 0, 10_000) || Number(entry.rootOverflow) > 1) addIssue(issues, `${field}.rootOverflow`, "must be at most 1 CSS pixel");
    if (entry.controlsWithinHorizontalBounds !== true) addIssue(issues, `${field}.controlsWithinHorizontalBounds`, "must be true");
    if (typeof entry.documentTitle !== "string" || entry.documentTitle.trim().length < 1) addIssue(issues, `${field}.documentTitle`, "must be a non-empty document title");
    if (!requireInteger(entry.mainTextLength, `${field}.mainTextLength`, issues, 1, 1_000_000)) addIssue(issues, `${field}.mainTextLength`, "must contain a visible route content signal");
    if (entry.titleMatched !== true) addIssue(issues, `${field}.titleMatched`, "must match the route-specific title oracle");
    for (const key of TELEMETRY_KEYS) if (!Array.isArray(entry[key]) || entry[key].length !== 0) addIssue(issues, `${field}.${key}`, "must be an empty array (telemetry must be zero)");
    if (entry.passed !== true) addIssue(issues, `${field}.passed`, "must be true");
  });
}


function validateZoomMetrics(raw: unknown, field: string, issues: G8ValidationIssue[]): void {
  if (!isRecord(raw)) {
    addIssue(issues, field, "must be an object");
    return;
  }
  exactKeys(raw, ZOOM_METRICS_KEYS, field, issues);
  requireInteger(raw.innerWidth, `${field}.innerWidth`, issues, 1, 20_000);
  if (typeof raw.devicePixelRatio !== "number" || !Number.isFinite(raw.devicePixelRatio) || raw.devicePixelRatio <= 0 || raw.devicePixelRatio > 10) addIssue(issues, `${field}.devicePixelRatio`, "must be a positive finite number");
}

function validateSummary(raw: unknown, results: JsonRecord[], zoomRaw: unknown, issues: G8ValidationIssue[]): void {
  if (!isRecord(raw)) {
    addIssue(issues, "summary", "must be an object");
    return;
  }
  exactKeys(raw, SUMMARY_KEYS, "summary", issues);
  const zoomResults = isRecord(zoomRaw) && Array.isArray(zoomRaw.results) ? zoomRaw.results.filter(isRecord) : [];
  const expected = {
    routeCount: RESPONSIVE_ROUTES.length,
    viewportCount: RESPONSIVE_VIEWPORTS.length,
    combinationCount: results.length,
    passed: results.filter((item) => item.passed === true).length,
    failed: results.filter((item) => item.passed !== true).length,
    rootOverflowFailures: results.filter((item) => typeof item.rootOverflow === "number" && item.rootOverflow > 1).length,
    unmeasurableRoutes: results.filter((item) => item.measurement === "unmeasurable").length,
    consoleErrorCount: results.reduce((sum, item) => sum + (Array.isArray(item.consoleErrors) ? item.consoleErrors.length : 0), 0),
    pageErrorCount: results.reduce((sum, item) => sum + (Array.isArray(item.pageErrors) ? item.pageErrors.length : 0), 0),
    failedRequestCount: results.reduce((sum, item) => sum + (Array.isArray(item.failedRequests) ? item.failedRequests.length : 0), 0),
    errorResponseCount: results.reduce((sum, item) => sum + (Array.isArray(item.errorResponses) ? item.errorResponses.length : 0), 0),
    zoomPassed: zoomResults.filter((item) => item.passed === true).length,
    zoomFailed: zoomResults.filter((item) => item.passed !== true).length,
    result: results.length === 343 && results.every((item) => item.passed === true) && zoomResults.length === 5 && zoomResults.every((item) => item.passed === true) ? "PASS" : "FAIL",
  } as const;
  for (const key of SUMMARY_KEYS) if (raw[key] !== expected[key]) addIssue(issues, `summary.${key}`, "must equal the value derived from results and zoom.results");
  if (raw.result !== "PASS") addIssue(issues, "summary.result", "must be PASS for admissible browser evidence");
}

function validateScreenshotDeclarations(
  raw: unknown,
  actual: G8ScreenshotEvidence[],
  root: string,
  runId: unknown,
  zoomRaw: unknown,
  issues: G8ValidationIssue[],
): void {
  const expectedPaths = typeof runId === "string" ? responsiveScreenshotPaths(runId) : [];
  if (!Array.isArray(raw) || raw.length !== expectedPaths.length) {
    addIssue(issues, "screenshotEvidence", `must contain exactly ${expectedPaths.length} declared screenshots`);
    return;
  }
  const zoomed = isRecord(zoomRaw) && isRecord(zoomRaw.zoomed) ? zoomRaw.zoomed : null;
  raw.forEach((entry, index) => {
    const expectedPath = expectedPaths[index];
    const [width, height] = index === RESPONSIVE_VIEWPORTS.length
      ? [null, zoomed && typeof zoomed.innerHeight === "number" ? zoomed.innerHeight : 1]
      : [RESPONSIVE_VIEWPORTS[index]?.width ?? null, RESPONSIVE_VIEWPORTS[index]?.height ?? 0];
    const evidence = readG8Screenshot(root, entry, expectedPath ?? "", `screenshotEvidence[${index}]`, width, height, true, actual, issues);
    if (index === RESPONSIVE_VIEWPORTS.length && evidence && zoomed && typeof zoomed.innerWidth === "number" && evidence.width < zoomed.innerWidth) {
      addIssue(issues, "screenshotEvidence[7]", "native zoom screenshot width must cover the observed zoomed viewport");
    }
  });
  if (actual.length !== expectedPaths.length) addIssue(issues, "screenshotEvidence", "all canonical screenshots must be readable");
}

function responsiveScreenshotPaths(runId: string): string[] {
  return [
    ...RESPONSIVE_VIEWPORTS.map((viewport) => `output/playwright/${runId}/screenshots/today-${viewport.width}.png`),
    `output/playwright/${runId}/screenshots/today-native-zoom-125.png`,
  ];
}

function isLoopbackOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
      && url.protocol === "http:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}

function responsiveScreenshotNames(): string[] {
  return [...RESPONSIVE_VIEWPORTS.map((viewport) => `today-${viewport.width}.png`), "today-native-zoom-125.png"];
}

function currentBinding(root: string): { commit: string; version: string; sourceHash: string } {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string };
  return { commit: currentGitCommit(root), version: packageJson.version ?? "", sourceHash: computeProductExperienceSourceHash(root) };
}

function main(): void {
  const usage = "Usage: pnpm exec tsx scripts/quality/responsive-layout-browser-matrix-validate.ts <evidence.json> [--expected-commit <sha>] [--expected-version <version>] [--expected-source-hash <sha>]";
  const args = process.argv.slice(2);
  const evidencePath = args.find((arg) => !arg.startsWith("--"));
  if (!evidencePath) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  try {
    const root = findWorkspaceRoot();
    const options = parseOptions(args, usage);
    const binding = buildExpectedBinding(root, options, currentBinding(root));
    const result = validateResponsiveLayoutBrowserMatrixFile(evidencePath, binding);
    if (!result.valid) {
      for (const issue of result.issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
      console.error(`FAIL responsive-layout-browser-matrix-validate ${result.issues.length} issue(s)`);
      process.exitCode = 1;
      return;
    }
    console.log(`PASS responsive-layout-browser-matrix-validate ${result.schemaVersion} (${result.itemCount} combinations; ${result.screenshots.length} screenshots hashed)`);
  } catch (error) {
    console.error(`ERROR ${safeV11Error(error)}`);
    console.error(usage);
    process.exitCode = 2;
  }
}

function parseOptions(args: string[], usage: string): Partial<Omit<G8EvidenceBinding, "root">> {
  const options: Partial<Omit<G8EvidenceBinding, "root">> = {};
  const allowed = new Set(["--expected-commit", "--expected-version", "--expected-source-hash"]);
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) continue;
    const next = args[index + 1];
    if (!allowed.has(arg) || !next || next.startsWith("--") || seen.has(arg)) throw new Error(usage);
    seen.add(arg);
    if (arg === "--expected-commit") options.expectedCommit = next;
    if (arg === "--expected-version") options.expectedVersion = next;
    if (arg === "--expected-source-hash") options.expectedSourceHash = next;
    index += 1;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
