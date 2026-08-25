import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { createStoredRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-core";
import { canonicalSha256 } from "./v11-browser-evidence-contract";
import {
  GOVERNANCE_SCENARIOS,
  RESPONSIVE_ROUTES,
  RESPONSIVE_VIEWPORTS,
  type G8EvidenceBinding,
} from "./g8-browser-evidence-common";

export type SelftestFixture = {
  root: string;
  binding: G8EvidenceBinding;
  responsivePath: string;
  governancePath: string;
  responsive: Record<string, unknown>;
  governance: Record<string, unknown>;
};

export function createG8SelftestFixture(root: string): SelftestFixture {
  const runResponsive = "responsive-g8-selftest";
  const runGovernance = "governance-g8-selftest";
  const responsiveDirectory = path.join(root, "output/playwright", runResponsive);
  const governanceDirectory = path.join(root, "output/playwright", runGovernance);
  mkdirSync(path.join(responsiveDirectory, "screenshots"), { recursive: true });
  mkdirSync(path.join(governanceDirectory, "screenshots"), { recursive: true });
  const expectedCommit = "a".repeat(40);
  const expectedSourceHash = `sha256:${"b".repeat(64)}`;
  const expectedVersion = "1.1.2";
  const binding: G8EvidenceBinding = { root, expectedCommit, expectedVersion, expectedSourceHash };
  const generatedAt = new Date(Date.now() - 1_000).toISOString();
  const runtimeIdentity = createRuntimeIdentity(expectedCommit, expectedVersion, expectedSourceHash, generatedAt);
  const pool = {
    slot: 1,
    container: "areaforge-dev-test-1",
    port: 43171,
    generation: 1_724_454_400_000,
    url: "http://127.0.0.1:43171",
    status: "running",
    commit: expectedCommit,
    sourceFingerprint: expectedSourceHash,
    buildId: runtimeIdentity.buildId,
    observedAt: generatedAt,
  };
  const environment = { baseUrl: pool.url, browser: "chromium", mode: "local-production-build", pool };

  for (const viewport of RESPONSIVE_VIEWPORTS) writePng(path.join(responsiveDirectory, "screenshots", `today-${viewport.width}.png`), viewport.width, viewport.height);
  writePng(path.join(responsiveDirectory, "screenshots", "today-native-zoom-125.png"), 2304, 1460);
  for (const scenario of GOVERNANCE_SCENARIOS) {
    const [width, height] = scenario.viewport.split("x").map(Number);
    writePng(path.join(governanceDirectory, "screenshots", scenario.screenshot), width, height);
  }

  const responsive = buildResponsive(root, runResponsive, responsiveDirectory, generatedAt, environment, runtimeIdentity);
  const governance = buildGovernance(root, runGovernance, governanceDirectory, generatedAt, environment, runtimeIdentity);
  const responsivePath = path.join(responsiveDirectory, "responsive-layout-browser-matrix.json");
  const governancePath = path.join(governanceDirectory, "web-governance-browser-interactions.json");
  writeFileSync(responsivePath, `${JSON.stringify(responsive, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(governancePath, `${JSON.stringify(governance, null, 2)}\n`, { mode: 0o600 });
  return { root, binding, responsivePath, governancePath, responsive, governance };
}

export function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cleanupG8SelftestFixture(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

function buildResponsive(root: string, runId: string, responsiveDirectory: string, generatedAt: string, environment: Record<string, unknown>, runtimeIdentity: Record<string, unknown>): Record<string, unknown> {
  const results: Record<string, unknown>[] = [];
  for (const viewport of RESPONSIVE_VIEWPORTS) {
    for (const route of RESPONSIVE_ROUTES) {
      const templatePath = route[0];
      const concretePath = route[1];
      const finalPath = templatePath === "/" || templatePath === "/login"
        ? "/login"
        : templatePath.startsWith("/confirmations")
          ? "/today"
          : templatePath === "/knowledge/resources/[resourceId]/preview"
            ? "/knowledge/resources/test-resource-link"
            : templatePath === "/knowledge/reviews/[scheduleId]/run"
              ? "/focus?returnTo=%2Ftoday"
              : concretePath;
      results.push({
        viewport: `${viewport.width}x${viewport.height}`,
        templatePath,
        concretePath,
        finalOrigin: environment.baseUrl,
        finalPath,
        status: 200,
        measurement: "measured",
        mainVisible: true,
        innerWidth: viewport.width,
        innerHeight: viewport.height,
        rootOverflow: 0,
        controlsWithinHorizontalBounds: true,
        documentTitle: route[2],
        mainTextLength: 100,
        titleMatched: true,
        specialContract: templatePath.startsWith("/confirmations") ? "confirmation-window" : templatePath === "/knowledge/resources/[resourceId]/preview" ? "link-preview-return" : null,
        contractVerified: true,
        windowOpened: templatePath.startsWith("/confirmations") ? true : null,
        consoleErrors: [],
        pageErrors: [],
        failedRequests: [],
        errorResponses: [],
        passed: true,
        failure: null,
      });
    }
  }
  const zoomResults = ["/focus", "/today", "/knowledge", "/roadmap/allocation", "/settings"].map((route) => ({
    path: route,
    finalOrigin: environment.baseUrl,
    finalPath: route,
    status: 200,
    innerWidth: 1152,
    innerHeight: 730,
    rootOverflow: 0,
    controlsWithinHorizontalBounds: true,
    documentTitle: route.slice(1),
    mainTextLength: 100,
    titleMatched: true,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    errorResponses: [],
    passed: true,
  }));
  return {
    schemaVersion: "responsive-layout-browser-matrix-v2",
    runId,
    generatedAt,
    environment,
    binding: { commit: runtimeIdentity.gitCommit, sourceFingerprint: runtimeIdentity.productExperienceSourceHash, capturePhase: "after-collection" },
    runtimeIdentity,
    safety: { loopbackOnly: true, authentication: "local-demo-button", businessWrites: false, migration: false, productionTouched: false },
    routes: RESPONSIVE_ROUTES.map(([templatePath, concretePath, title]) => ({ templatePath, concretePath, title })),
    viewports: RESPONSIVE_VIEWPORTS,
    zoom: { requested: "125%", mechanism: "Chrome default zoom", baseline: { innerWidth: 1440, devicePixelRatio: 2 }, zoomed: { innerWidth: 1152, devicePixelRatio: 2.5 }, selectedValue: "1.25", results: zoomResults },
    summary: { routeCount: 49, viewportCount: 7, combinationCount: 343, passed: 343, failed: 0, rootOverflowFailures: 0, unmeasurableRoutes: 0, consoleErrorCount: 0, pageErrorCount: 0, failedRequestCount: 0, errorResponseCount: 0, zoomPassed: 5, zoomFailed: 0, result: "PASS" },
    results,
    screenshotEvidence: screenshotEvidenceFor(root, responsiveDirectory, [...RESPONSIVE_VIEWPORTS.map((viewport) => ({ name: `today-${viewport.width}.png`, width: viewport.width, height: viewport.height })), { name: "today-native-zoom-125.png", width: 2304, height: 1460 }]),
    doesNotProve: ["GitHub Release exists for this checkout", "production apply completed", "production health or production UX", "business mutation journeys"],
  };
}

function buildGovernance(root: string, runId: string, governanceDirectory: string, generatedAt: string, environment: Record<string, unknown>, runtimeIdentity: Record<string, unknown>): Record<string, unknown> {
  const screenshotEvidence = screenshotEvidenceFor(root, governanceDirectory, GOVERNANCE_SCENARIOS.map((scenario) => {
    const [width, height] = scenario.viewport.split("x").map(Number);
    return { name: scenario.screenshot, width, height };
  }));
  const results = GOVERNANCE_SCENARIOS.map((scenario) => ({
    id: scenario.id,
    viewport: scenario.viewport,
    facts: factsForScenario(scenario.id),
    screenshots: screenshotEvidence.filter((entry) => entry.path === `output/playwright/${runId}/screenshots/${scenario.screenshot}`),
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    errorResponses: [],
    expectedErrorResponses: scenario.id === "resource-409-input-retention" ? ["409 PATCH http://127.0.0.1:43171/api/study-resources/test-resource-link"] : [],
    passed: true,
    failure: null,
  }));
  return {
    schemaVersion: "web-governance-browser-interactions-v2",
    runId,
    generatedAt,
    environment,
    binding: { commit: runtimeIdentity.gitCommit, sourceFingerprint: runtimeIdentity.productExperienceSourceHash, capturePhase: "after-collection" },
    runtimeIdentity,
    safety: { loopbackOnly: true, authentication: "local-demo-button", businessWrites: false, mutationRequests: "route-intercepted", migration: false, productionTouched: false },
    summary: { total: 7, passed: 7, failed: 0, consoleErrorCount: 0, pageErrorCount: 0, failedRequestCount: 0, unexpectedErrorResponseCount: 0, expectedErrorResponseCount: 1, result: "PASS" },
    results,
    screenshotEvidence,
    doesNotProve: ["GitHub Release exists for this checkout", "production apply completed", "production health or production UX", "real AI provider behavior", "real upload persistence or attachment storage", "multi-device concurrency against a live server writer"],
  };
}

function factsForScenario(id: string): Record<string, unknown> {
  if (id === "overlay-escape-focus") return { drawerEscapeClosed: true, drawerFocusRestored: true, windowEscapeMinimized: true, windowFocusRestored: true, dockVisible: true };
  if (id === "draft-current" || id === "draft-stale" || id === "draft-legacy") {
    const status = id.replace("draft-", "");
    const conflict = status !== "current";
    return { status, storageKeyPrefix: "areaforge.resource.draft.detail.", restoredValue: `G8-${status}-draft`, baseRevision: 1, conflictRequired: conflict, submitLockedBeforeResolution: conflict };
  }
  if (id === "resource-409-input-retention") return { interceptedStatus: 409, submittedTitle: "G8 本机冲突输入必须保留", retainedTitle: "G8 本机冲突输入必须保留", conflictFields: ["revision", "title"], automaticOverwrite: false };
  if (id === "ai-latest-wins") return { previewRequestCount: 2, duplicateClickRequestCount: 1, requestTexts: ["G8 FIRST", "G8 SECOND"], visiblePreview: "G8_SECOND_PREVIEW", stalePreviewVisible: false, pendingLocked: true };
  return { stageRequestCount: 1, resolveRequestCount: 1, originalFileName: "governance-original.md", pendingControlsLocked: true, pendingSubmitControl: "disabled", duplicateClickSuppressed: true, resolvedSnapshot: { attachmentId: "g8-staged-attachment", decision: "skip", title: "governance-original.md", subjectId: null, category: "COURSE", tags: ["alpha", "beta"] } };
}

function createRuntimeIdentity(commit: string, version: string, sourceHash: string, observedAt: string): Record<string, unknown> {
  const stored = createStoredRuntimeIdentity({
    appVersion: version,
    gitCommit: commit,
    sourceFingerprintSchema: "ux-source-v2",
    productExperienceSourceHash: sourceHash,
    buildId: canonicalSha256({ domain: "g8-selftest-build", commit, sourceHash }),
    runtimeMode: "production-build",
  });
  return { ...stored, observedAt, reasonCode: "NONE" };
}

function screenshotEvidenceFor(
  root: string,
  directory: string,
  entries: Array<{ name: string; width: number; height: number }>,
): Array<Record<string, unknown>> {
  return entries.map((entry) => {
    const absolute = path.join(directory, "screenshots", entry.name);
    const relative = path.relative(root, absolute);
    const bytes = readFileSync(absolute);
    return {
      path: relative.split(path.sep).join("/"),
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      width: entry.width,
      height: entry.height,
    };
  });
}

function writePng(filePath: string, width: number, height: number): void {
  const rowBytes = width;
  const inflated = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * (rowBytes + 1);
    inflated[rowOffset] = 0;
    inflated[rowOffset + 1] = row % 2 === 0 ? 32 : 224;
    if (rowBytes > 1) inflated[rowOffset + rowBytes] = row % 2 === 0 ? 224 : 32;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(inflated)), chunk("IEND", Buffer.alloc(0))]);
  writeFileSync(filePath, png, { mode: 0o600 });
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  // Node does not expose CRC32 on all supported versions; use the small PNG table below.
  let value = 0xffffffff;
  for (const byte of Buffer.concat([typeBytes, data])) value = crc32Byte(value, byte);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); typeBytes.copy(out, 4); data.copy(out, 8); out.writeUInt32BE((value ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

function crc32Byte(crc: number, byte: number): number {
  let value = (crc ^ byte) >>> 0;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) >>> 0 : value >>> 1;
  return value;
}
