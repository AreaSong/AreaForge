import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, writeFileSync } from "node:fs";
import { link, mkdtemp, open, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { validateRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-core";
import { prisma } from "../../packages/db/src/index";
import {
  V11_ACCESSIBILITY_CATEGORIES,
  V11_ACCESSIBILITY_OBSERVATION_SCHEMA,
  V11_ACCESSIBILITY_SCHEMA,
  V11_CATEGORY_COUNTS,
  V11_DOES_NOT_PROVE,
  V11_JOURNEY_IDS,
  V11_JOURNEY_SCHEMA,
  V11_VIEWPORT_CONTRACT,
  V11_VIEWPORTS,
  computeFixtureManifestHash,
  computeRuntimeResponseHash,
  type V11AccessibilityEvidence,
  type V11AccessibilityCategory,
  type V11AccessibilityObservation,
  type V11EvidenceBinding,
  type V11EvidenceEnvironment,
  type V11FixtureEvidence,
  type V11JourneyEvidence,
  type V11RuntimeIdentity,
  type V11RuntimeIdentityEvidence,
  type V11SafetyFacts,
} from "../quality/v11-browser-evidence-contract";
import { computeProductExperienceSourceHash, currentGitCommit } from "../quality/product-experience-source";
import { validateV11BrowserEvidence, validateV11BrowserEvidenceFile } from "../quality/v11-browser-evidence-validate";
import { runAccessibilitySuite, type AccessibilityArtifactWriter } from "./v11-accessibility-suite";
import {
  createBrowserFixtureSet,
  createNoClobberOutputDirectory,
  assertBrowserEvidenceDatabasePreflight,
  loadBrowserEvidenceConfig,
  type BrowserEvidenceConfig,
  type FixtureManifest,
} from "./v11-browser-fixtures";
import { runJourneySuite, type JourneyScreenshotWriter } from "./v11-browser-journeys";

const JOURNEY_EVIDENCE_FILE = "v11-browser-journey-evidence.json";
const ACCESSIBILITY_EVIDENCE_FILE = "v11-accessibility-evidence.json";
const MAX_HEALTH_RESPONSE_BYTES = 16 * 1024;
const PINNED_PLAYWRIGHT_VERSION = "1.62.0";

interface WrittenEvidenceFile { relativePath: string; sha256: string }
interface BrowserEvidenceResult { journey: WrittenEvidenceFile; accessibility: WrittenEvidenceFile }

export async function runV11BrowserEvidence(): Promise<BrowserEvidenceResult> {
  let browser: Browser | null = null;
  let nativeContext: BrowserContext | null = null;
  let browserProfileDirectory: string | null = null;
  let prismaUsed = false;
  try {
    const config = loadBrowserEvidenceConfig();
    const binding = await currentBinding(config.root);
    const preflightRuntimeIdentityEvidence = await captureRuntimeIdentity(config, binding);
    const playwrightVersion = await readPinnedPlaywrightVersion(config.root);

    prismaUsed = true;
    await assertBrowserEvidenceDatabasePreflight(config);
    await createNoClobberOutputDirectory(config);
    browserProfileDirectory = await mkdtemp(path.join(tmpdir(), "areaforge-v11-browser-profile-"));
    nativeContext = await chromium.launchPersistentContext(browserProfileDirectory, {
      executablePath: config.chromeExecutablePath,
      headless: false,
      viewport: null,
      args: [
        "--window-size=1440,1000",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    browser = nativeContext.browser();
    if (!browser) throw new Error("persistent Chrome context did not expose its browser instance");

    const environment: V11EvidenceEnvironment = {
      kind: "local-production-mode",
      baseUrl: config.baseUrl.origin,
      browserName: "chrome",
      browserVersion: browser.version(),
      playwrightVersion,
    };
    assertEnvironmentTokens(environment);

    const fixtureSet = await createBrowserFixtureSet(config.password);
    assertFixtureIsolation(fixtureSet);
    const fixtureEvidenceRecord = fixtureEvidence(fixtureSet.manifest);
    const screenshots = createScreenshotWriter(config);
    const journeys = await runJourneySuite({
      browser,
      config,
      fixtures: fixtureSet.journeys,
      screenshots: screenshots.writer,
    });
    if (screenshots.count() !== 18) throw new Error("journey suite did not write exactly 18 screenshots");

    const checks = await runAccessibilitySuite({
      browser,
      nativeContext,
      config,
      fixture: fixtureSet.accessibility,
      artifacts: createAccessibilityArtifactWriter(config),
    });
    assertBindingUnchanged(binding, await currentBinding(config.root));
    const runtimeIdentityEvidence = await captureRuntimeIdentity(config, binding);
    if (
      runtimeIdentityEvidence.runtimeIdentity.identityHash
      !== preflightRuntimeIdentityEvidence.runtimeIdentity.identityHash
    ) {
      throw new Error("local runtime identity changed during browser evidence collection");
    }
    const generatedAt = new Date().toISOString();
    const safetyFacts = localSafetyFacts();
    const journeyEvidence: V11JourneyEvidence = {
      schemaVersion: V11_JOURNEY_SCHEMA,
      generatedAt,
      environment,
      runtimeIdentityEvidence,
      fixtureEvidence: fixtureEvidenceRecord,
      summary: {
        total: 18,
        passed: 18,
        failed: 0,
        skipped: 0,
        desktop: 9,
        mobile: 9,
        uiOriginatedMutations: 18,
        getOnlyOracles: 18,
        unexplainedFailureCount: 0,
      },
      journeys,
      doesNotProve: [...V11_DOES_NOT_PROVE],
      safetyFacts,
    };
    const accessibilityEvidence: V11AccessibilityEvidence = {
      schemaVersion: V11_ACCESSIBILITY_SCHEMA,
      generatedAt,
      environment,
      runtimeIdentityEvidence,
      fixtureEvidence: fixtureEvidenceRecord,
      summary: {
        total: 24,
        passed: 24,
        failed: 0,
        skipped: 0,
        categories: V11_ACCESSIBILITY_CATEGORIES.map((category) => ({
          category,
          total: V11_CATEGORY_COUNTS[category],
          passed: V11_CATEGORY_COUNTS[category],
          failed: 0,
          skipped: 0,
        })),
      },
      checks,
      doesNotProve: [...V11_DOES_NOT_PROVE],
      safetyFacts,
    };

    assertEvidenceValid(journeyEvidence, accessibilityEvidence, binding);
    const journey = await writeEvidenceJson(config, JOURNEY_EVIDENCE_FILE, journeyEvidence);
    const accessibility = await writeEvidenceJson(
      config,
      ACCESSIBILITY_EVIDENCE_FILE,
      accessibilityEvidence,
    );
    const persistedBinding = await currentBinding(config.root);
    assertBindingUnchanged(binding, persistedBinding);
    assertEvidenceFilesValid(journey.relativePath, accessibility.relativePath, persistedBinding);
    return { journey, accessibility };
  } finally {
    await closeResources(browser, nativeContext, browserProfileDirectory, prismaUsed);
  }
}

async function currentBinding(root: string): Promise<V11EvidenceBinding> {
  const packageValue = parseJson(await readFile(path.join(root, "package.json")));
  const version = asRecord(packageValue).version;
  if (typeof version !== "string") throw new Error("workspace package version is unavailable");
  return {
    root,
    expectedCommit: currentGitCommit(root),
    expectedVersion: version,
    expectedSourceHash: computeProductExperienceSourceHash(root),
  };
}

function assertBindingUnchanged(before: V11EvidenceBinding, after: V11EvidenceBinding): void {
  if (
    before.root !== after.root
    || before.expectedCommit !== after.expectedCommit
    || before.expectedVersion !== after.expectedVersion
    || before.expectedSourceHash !== after.expectedSourceHash
  ) {
    throw new Error("workspace evidence binding changed during browser evidence collection");
  }
}

async function captureRuntimeIdentity(
  config: BrowserEvidenceConfig,
  binding: V11EvidenceBinding,
): Promise<V11RuntimeIdentityEvidence> {
  const healthUrl = new URL("/api/health", config.baseUrl);
  const response = await fetch(healthUrl, {
    method: "GET",
    redirect: "manual",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (response.status !== 200 || response.redirected || response.url !== healthUrl.toString()) {
    throw new Error("local runtime health request did not return a direct HTTP 200 response");
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error("local runtime health response is not JSON");
  }
  const body = asRecord(parseJson(await readBoundedResponse(response, MAX_HEALTH_RESPONSE_BYTES)));
  assertExactKeys(body, ["ok", "runtimeIdentity", "service", "version"], "health response");
  if (body.ok !== true || body.service !== "AreaForge") {
    throw new Error("local runtime health response does not identify a verified AreaForge service");
  }
  const runtimeIdentity = validateRuntimeIdentity(body.runtimeIdentity) as V11RuntimeIdentity;
  if (body.version !== runtimeIdentity.appVersion) {
    throw new Error("local runtime health version does not match its runtime identity");
  }
  if (runtimeIdentity.runtimeMode !== "production-build") {
    throw new Error("browser evidence requires a production-build runtime");
  }
  if (
    runtimeIdentity.gitCommit !== binding.expectedCommit
    || runtimeIdentity.appVersion !== binding.expectedVersion
    || runtimeIdentity.productExperienceSourceHash !== binding.expectedSourceHash
  ) {
    throw new Error("local runtime identity does not match the current workspace binding");
  }
  const observedAt = Date.parse(runtimeIdentity.observedAt);
  const now = Date.now();
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(runtimeIdentity.observedAt)
    || observedAt > now + 5 * 60_000
    || now - observedAt > 2 * 60 * 60_000
  ) {
    throw new Error("local runtime identity observation is outside the admissible evidence window");
  }
  return {
    request: { method: "GET", path: "/api/health", status: 200 },
    runtimeIdentity,
    responseSha256: computeRuntimeResponseHash(runtimeIdentity),
  };
}

async function readBoundedResponse(response: Response, limit: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isInteger(length) || length < 0 || length > limit) {
      throw new Error("local runtime health response exceeds the size limit");
    }
  }
  if (!response.body) throw new Error("local runtime health response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("local runtime health response exceeds the size limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, total);
}

async function readPinnedPlaywrightVersion(root: string): Promise<string> {
  const packageValue = parseJson(await readFile(path.join(root, "node_modules/playwright-core/package.json")));
  const version = asRecord(packageValue).version;
  if (version !== PINNED_PLAYWRIGHT_VERSION) {
    throw new Error("browser evidence requires the pinned root playwright-core version");
  }
  return version;
}

function assertFixtureIsolation(fixtureSet: Awaited<ReturnType<typeof createBrowserFixtureSet>>): void {
  if (fixtureSet.journeys.length !== 18) throw new Error("fixture set must contain 18 journey accounts");
  const combinations = new Set(fixtureSet.journeys.map((fixture) => `${fixture.viewport}:${fixture.journeyId}`));
  const expected = V11_VIEWPORTS.flatMap((viewport) =>
    V11_JOURNEY_IDS.map((journey) => `${viewport}:${journey}`));
  if (expected.some((item) => !combinations.has(item)) || combinations.size !== expected.length) {
    throw new Error("fixture set does not contain every required journey and viewport combination");
  }
  const accountRefs = new Set(fixtureSet.journeys.map((fixture) => fixture.accountRef));
  if (accountRefs.size !== 18 || accountRefs.has(fixtureSet.accessibility.accountRef)) {
    throw new Error("fixture accounts are not independently isolated");
  }
}

function fixtureEvidence(manifest: FixtureManifest): V11FixtureEvidence {
  const { manifestSha256, ...projection } = manifest;
  const computedHash = computeFixtureManifestHash(projection);
  if (manifestSha256 !== computedHash) {
    throw new Error("fixture manifest hash changed before evidence serialization");
  }
  return { ...projection, manifestSha256 };
}

function localSafetyFacts(): V11SafetyFacts {
  return {
    localBaseUrl: true,
    localDatabase: true,
    explicitWriteOptIn: true,
    passwordSource: "restricted-file",
    productionWriteAttempted: false,
    serverCommandAttempted: false,
    backupRestoreAttempted: false,
    migrationAttempted: false,
    destructiveActionAttempted: false,
    updaterApplyAttempted: false,
    releaseCreated: false,
    secretValuePrinted: false,
    realStudyContentIncluded: false,
    residualLedgerUpdated: false,
  };
}

function createScreenshotWriter(config: BrowserEvidenceConfig): {
  writer: JourneyScreenshotWriter;
  count: () => number;
} {
  const written = new Set<string>();
  return {
    writer: {
      async write(name, bytes) {
        const match = /^(desktop|mobile)-([a-z-]+)\.png$/.exec(name);
        if (!match || !V11_JOURNEY_IDS.includes(match[2] as never)) {
          throw new Error("journey screenshot name is outside the fixed contract");
        }
        if (written.has(name)) throw new Error("journey screenshot name is duplicated");
        if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("journey screenshot exceeds the size limit");
        const dimensions = pngDimensions(bytes);
        const viewport = match[1] as (typeof V11_VIEWPORTS)[number];
        const expected = V11_VIEWPORT_CONTRACT[viewport];
        if (
          dimensions.width !== expected.width
          || dimensions.height !== expected.height
        ) {
          throw new Error("journey screenshot dimensions do not match the fixed viewport");
        }
        const absolute = path.join(config.outputDirectory, "screenshots", name);
        await writeNoClobberFile(absolute, bytes);
        written.add(name);
        return {
          path: repoRelativePath(config.root, absolute),
          sha256: sha256(bytes),
          width: dimensions.width,
          height: dimensions.height,
          syntheticContent: true,
        };
      },
    },
    count: () => written.size,
  };
}

function createAccessibilityArtifactWriter(config: BrowserEvidenceConfig): AccessibilityArtifactWriter {
  const written = new Set<string>();
  return {
    write(check) {
      const name = `a11y-${check.id.toLowerCase()}.json`;
      if (!/^a11y-(?:kbd|focus|sem|live|color|zoom|canvas)-\d{2}\.json$/.test(name)) {
        throw new Error("accessibility observation name is outside the fixed contract");
      }
      if (written.has(name)) throw new Error("accessibility observation name is duplicated");
      const observation: V11AccessibilityObservation = {
        schemaVersion: V11_ACCESSIBILITY_OBSERVATION_SCHEMA,
        recordedAt: new Date().toISOString(),
        checkId: check.id,
        checkKey: check.checkKey,
        route: check.route,
        target: check.target,
        profile: check.profile,
        mechanism: check.mechanism,
        assertions: check.assertions,
      };
      const bytes = Buffer.from(`${JSON.stringify(observation, null, 2)}\n`, "utf8");
      if (bytes.byteLength > 1024 * 1024) throw new Error("accessibility observation exceeds the size limit");
      const directory = path.join(config.outputDirectory, "observations");
      const absolute = path.join(directory, name);
      const descriptor = openSync(absolute, "wx", 0o600);
      try {
        writeFileSync(descriptor, bytes);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      const directoryDescriptor = openSync(directory, "r");
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
      written.add(name);
      return {
        kind: accessibilityArtifactKind(check.category),
        path: repoRelativePath(config.root, absolute),
        sha256: sha256(bytes),
        observationCount: check.assertions.length,
      };
    },
  };
}

function accessibilityArtifactKind(category: V11AccessibilityCategory) {
  return {
    keyboard: "keyboard-trace",
    focus: "focus-trace",
    semantics: "accessibility-tree",
    live: "live-region-trace",
    color: "computed-style",
    zoom: "reflow-measurement",
    canvas: "canvas-equivalence",
  }[category] as V11AccessibilityEvidence["checks"][number]["artifact"]["kind"];
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const buffer = Buffer.from(bytes);
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (
    buffer.length < 24
    || !buffer.subarray(0, 8).equals(signature)
    || buffer.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("journey screenshot is not a valid PNG header");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1) throw new Error("journey screenshot has invalid dimensions");
  return { width, height };
}

async function writeNoClobberFile(absolute: string, bytes: Uint8Array): Promise<void> {
  const file = await open(absolute, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  await syncDirectory(path.dirname(absolute));
}

async function writeEvidenceJson(
  config: BrowserEvidenceConfig,
  name: typeof JOURNEY_EVIDENCE_FILE | typeof ACCESSIBILITY_EVIDENCE_FILE,
  value: V11JourneyEvidence | V11AccessibilityEvidence,
): Promise<WrittenEvidenceFile> {
  const finalPath = path.join(config.outputDirectory, name);
  const temporaryPath = path.join(config.outputDirectory, `.${name}.${randomUUID()}.tmp`);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporaryPath, finalPath);
    await unlink(temporaryPath);
    await syncDirectory(config.outputDirectory);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return { relativePath: repoRelativePath(config.root, finalPath), sha256: sha256(bytes) };
}

function assertEvidenceValid(
  journey: V11JourneyEvidence,
  accessibility: V11AccessibilityEvidence,
  binding: V11EvidenceBinding,
): void {
  const results = [
    validateV11BrowserEvidence(journey, binding),
    validateV11BrowserEvidence(accessibility, binding),
  ];
  if (results.some((result) => !result.valid)) {
    throw new Error("generated browser evidence failed in-memory contract validation");
  }
}

function assertEvidenceFilesValid(
  journeyPath: string,
  accessibilityPath: string,
  binding: V11EvidenceBinding,
): void {
  const results = [
    validateV11BrowserEvidenceFile(journeyPath, binding),
    validateV11BrowserEvidenceFile(accessibilityPath, binding),
  ];
  if (results.some((result) => !result.valid)) {
    throw new Error("generated browser evidence failed persisted-file contract validation");
  }
}

function assertEnvironmentTokens(environment: V11EvidenceEnvironment): void {
  const shortToken = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
  if (!shortToken.test(environment.browserVersion) || !shortToken.test(environment.playwrightVersion)) {
    throw new Error("browser evidence environment versions are not safe short tokens");
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const directory = await open(directoryPath, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function closeResources(
  browser: Browser | null,
  nativeContext: BrowserContext | null,
  browserProfileDirectory: string | null,
  prismaUsed: boolean,
): Promise<void> {
  const results = await Promise.allSettled([
    nativeContext ? nativeContext.close() : browser ? browser.close() : Promise.resolve(),
    prismaUsed ? prisma.$disconnect() : Promise.resolve(),
  ]);
  let profileCleanupFailed = false;
  if (browserProfileDirectory) {
    try {
      await rm(browserProfileDirectory, { recursive: true, force: true });
    } catch {
      profileCleanupFailed = true;
    }
  }
  if (profileCleanupFailed || results.some((result) => result.status === "rejected")) {
    throw new Error("browser evidence resource cleanup failed");
  }
}

function repoRelativePath(root: string, absolute: string): string {
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("browser evidence artifact path escapes the workspace");
  }
  return relative.split(path.sep).join("/");
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} fields are not exact`);
  }
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error("JSON input is invalid");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON input must be an object");
  }
  return value as Record<string, unknown>;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function failureReference(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown browser evidence failure";
  return sha256(Buffer.from(message, "utf8"));
}

async function main(): Promise<void> {
  const result = await runV11BrowserEvidence();
  console.log(`PASS journey ${result.journey.relativePath} ${result.journey.sha256}`);
  console.log(`PASS accessibility ${result.accessibility.relativePath} ${result.accessibility.sha256}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`FAIL v11-browser-evidence ${failureReference(error)}`);
    process.exitCode = 1;
  });
}
