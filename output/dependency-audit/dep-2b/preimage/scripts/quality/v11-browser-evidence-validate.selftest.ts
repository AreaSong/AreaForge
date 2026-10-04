import { createHash } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { createStoredRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-core";
import {
  V11_ACCESSIBILITY_CATEGORIES,
  V11_ACCESSIBILITY_CHECK_IDS,
  V11_ACCESSIBILITY_CHECK_CONTRACTS,
  V11_ACCESSIBILITY_OBSERVATION_SCHEMA,
  V11_ACCESSIBILITY_PROFILE_CONTRACT,
  V11_ACCESSIBILITY_SCHEMA,
  V11_CATEGORY_COUNTS,
  V11_DOES_NOT_PROVE,
  V11_FIXTURE_SCHEMA,
  V11_JOURNEY_CONTRACTS,
  V11_JOURNEY_IDS,
  V11_JOURNEY_SCHEMA,
  V11_VIEWPORT_CONTRACT,
  V11_VIEWPORTS,
  canonicalSha256,
  categoryForCheck,
  computeFixtureManifestHash,
  computeRuntimeResponseHash,
  type V11Assertion,
  type V11AssertionContract,
  type V11EvidenceBinding,
  type V11FixtureEvidence,
  type V11RuntimeIdentity,
} from "./v11-browser-evidence-contract";
import { validateV11BrowserEvidence, validateV11BrowserEvidenceFile } from "./v11-browser-evidence-validate";

type MutableRecord = Record<string, any>;

const root = path.join(tmpdir(), `areaforge-v11-browser-validator-${process.pid}-${Date.now()}`);
const artifactsDir = path.join(root, "artifacts");
const screenshotsDir = path.join(artifactsDir, "screenshots");
const expectedCommit = "a".repeat(40);
const expectedVersion = "1.1.0";
const expectedSourceHash = canonicalSha256({ fixture: "source" });
const binding: V11EvidenceBinding = { root, expectedCommit, expectedVersion, expectedSourceHash };
const viewportPng = {
  desktop: buildPng(V11_VIEWPORT_CONTRACT.desktop.width, V11_VIEWPORT_CONTRACT.desktop.height),
  mobile: buildPng(V11_VIEWPORT_CONTRACT.mobile.width, V11_VIEWPORT_CONTRACT.mobile.height),
};

mkdirSync(screenshotsDir, { recursive: true });
try {
  const fixtureEvidence = fixture();
  const journey = buildJourneyEvidence(fixtureEvidence);
  const accessibility = buildAccessibilityEvidence(fixtureEvidence);
  writeJson("journey.json", journey);
  writeJson("accessibility.json", accessibility);

  expectValid(validateV11BrowserEvidence(journey, binding), "valid journey value");
  expectValid(validateV11BrowserEvidence(accessibility, binding), "valid accessibility value");
  expectValid(validateV11BrowserEvidenceFile("journey.json", binding), "valid journey file");
  expectValid(validateV11BrowserEvidenceFile("accessibility.json", binding), "valid accessibility file");

  const forgedPass = clone(journey);
  forgedPass.journeys[0].terminalAssertions[0].actual = false;
  forgedPass.journeys[0].terminalAssertions[0].passed = true;
  expectInvalid(forgedPass, "forged passed=true", "recomputed from predicate");

  const missingAssertionValue = clone(journey);
  delete missingAssertionValue.journeys[0].terminalAssertions[0].actual;
  expectInvalid(missingAssertionValue, "missing assertion value fails closed", "keys must be exactly");

  const missingId = clone(accessibility);
  missingId.checks.pop();
  expectInvalid(missingId, "missing accessibility ID", "missing required ID");

  const bottomFailure = clone(accessibility);
  bottomFailure.checks[0].assertions[0].passed = false;
  expectInvalid(bottomFailure, "top-level pass cannot hide a failed assertion", "recomputed from predicate");

  const wrongStartRoute = clone(journey);
  wrongStartRoute.journeys[0].startPath = "/today";
  expectInvalid(wrongStartRoute, "fixed start route", "fixed route contract");

  const wrongTerminalRoute = clone(journey);
  wrongTerminalRoute.journeys[1].terminalPath = "/today";
  expectInvalid(wrongTerminalRoute, "fixed terminal route", "fixed route contract");

  const wrongMutationMethod = clone(journey);
  wrongMutationMethod.journeys[0].mutation.method = "PATCH";
  expectInvalid(wrongMutationMethod, "fixed mutation method", "fixed journey mutation method");

  const wrongMutationPath = clone(journey);
  wrongMutationPath.journeys[0].mutation.path = "/api/auth/logout";
  expectInvalid(wrongMutationPath, "fixed mutation path", "fixed route contract");

  const wrongMutationStatus = clone(journey);
  wrongMutationStatus.journeys[0].mutation.status = 201;
  expectInvalid(wrongMutationStatus, "fixed mutation status", "fixed journey mutation status");

  const duplicateRequest = clone(journey);
  duplicateRequest.journeys[0].mutation.requestCount = 2;
  expectInvalid(duplicateRequest, "duplicate request", "must be exactly 1");

  const wrongOraclePath = clone(journey);
  wrongOraclePath.journeys[0].oracle.path = "/api/auth/me";
  expectInvalid(wrongOraclePath, "fixed GET oracle", "fixed route contract");

  const wrongAssertionOrder = clone(journey);
  wrongAssertionOrder.journeys[1].oracle.after.assertions.reverse();
  expectInvalid(wrongAssertionOrder, "journey assertion order", "fixed assertion ID and order");

  const wrongExpectedSemantics = clone(journey);
  wrongExpectedSemantics.journeys[0].oracle.before.assertions[0].expected = 200;
  wrongExpectedSemantics.journeys[0].oracle.before.assertions[0].actual = 200;
  expectInvalid(wrongExpectedSemantics, "journey expected semantics", "fixed assertion expected semantics");

  const wrongPredicate = clone(journey);
  wrongPredicate.journeys[0].terminalAssertions[0].predicate = "not-equals";
  wrongPredicate.journeys[0].terminalAssertions[0].actual = false;
  expectInvalid(wrongPredicate, "journey predicate semantics", "fixed assertion predicate");

  const wrongA11yRoute = clone(accessibility);
  wrongA11yRoute.checks[0].route = "/today";
  expectInvalid(wrongA11yRoute, "fixed accessibility route", "fixed route contract");

  const wrongA11yMechanism = clone(accessibility);
  wrongA11yMechanism.checks[0].mechanism = "dom";
  expectInvalid(wrongA11yMechanism, "fixed accessibility mechanism", "fixed check mechanism");

  const wrongA11yAssertion = clone(accessibility);
  wrongA11yAssertion.checks[0].assertions[0].id = "forged-assertion";
  expectInvalid(wrongA11yAssertion, "fixed accessibility assertion", "fixed assertion ID and order");

  const rangeForgery = clone(accessibility);
  const zoom = rangeForgery.checks.find((check: MutableRecord) => check.id === "ZOOM-01");
  const ratio = zoom.assertions.find((assertion: MutableRecord) => assertion.id === "native-css-viewport-ratio-is-two");
  ratio.actual = 3;
  ratio.passed = true;
  expectInvalid(rangeForgery, "range predicate recomputation", "recomputed from predicate");

  const declaredHashTamper = clone(journey);
  declaredHashTamper.journeys[0].screenshot.sha256 = `sha256:${"f".repeat(64)}`;
  expectInvalid(declaredHashTamper, "declared screenshot hash tamper", ".screenshot.sha256");

  const runtimeMismatch = clone(journey);
  runtimeMismatch.runtimeIdentityEvidence.runtimeIdentity = runtimeIdentity("b".repeat(40));
  runtimeMismatch.runtimeIdentityEvidence.responseSha256 = computeRuntimeResponseHash(runtimeMismatch.runtimeIdentityEvidence.runtimeIdentity);
  expectInvalid(runtimeMismatch, "runtime commit mismatch", ".gitCommit");

  const duplicateJourney = clone(journey);
  duplicateJourney.journeys[1] = clone(duplicateJourney.journeys[0]);
  expectInvalid(duplicateJourney, "duplicate journey", "duplicate journey/viewport");

  const duplicateCheck = clone(accessibility);
  duplicateCheck.checks[1] = clone(duplicateCheck.checks[0]);
  expectInvalid(duplicateCheck, "duplicate accessibility check", "duplicate check");

  const skipped = clone(accessibility);
  skipped.checks[0].result = "skip";
  expectInvalid(skipped, "skip is forbidden", "skip/fail is not admissible");

  const wrongCheckKey = clone(accessibility);
  wrongCheckKey.checks[0].checkKey = "wrong-check-key";
  expectInvalid(wrongCheckKey, "stable check key mismatch", "stable check contract");

  const wrongProfile = clone(accessibility);
  wrongProfile.checks[0].profile = V11_ACCESSIBILITY_PROFILE_CONTRACT["mobile-portrait"];
  expectInvalid(wrongProfile, "profile mismatch", "fixed accessibility profile contract");

  const nonUiMutation = clone(journey);
  nonUiMutation.journeys[0].mutation.initiatedBy = "api-client";
  nonUiMutation.journeys[0].mutation.uiOriginatedMutation = false;
  expectInvalid(nonUiMutation, "non-UI mutation", "page-ui");

  const postOracle = clone(journey);
  postOracle.journeys[0].oracle.method = "POST";
  expectInvalid(postOracle, "POST oracle", "GET-only");

  const secretLike = clone(journey);
  secretLike.fixtureEvidence.fixtureSetId = "sk-1234567890123456";
  expectInvalid(secretLike, "secret-like text", "secret-like text");

  const fixtureHashTamper = clone(journey);
  fixtureHashTamper.fixtureEvidence.manifestSha256 = `sha256:${"e".repeat(64)}`;
  expectInvalid(fixtureHashTamper, "fixture hash tamper", "manifestSha256");

  const fixtureAccountMismatch = clone(journey);
  fixtureAccountMismatch.fixtureEvidence.accounts[0].accountRef = canonicalSha256({ mismatch: true });
  rehashFixture(fixtureAccountMismatch.fixtureEvidence);
  expectInvalid(fixtureAccountMismatch, "fixture account to journey mismatch", "canonical fixture manifest account");

  const fixtureDuplicateAccount = clone(journey);
  fixtureDuplicateAccount.fixtureEvidence.accounts[1].accountRef = fixtureDuplicateAccount.fixtureEvidence.accounts[0].accountRef;
  rehashFixture(fixtureDuplicateAccount.fixtureEvidence);
  expectInvalid(fixtureDuplicateAccount, "duplicate fixture account", "unique across all 19");

  const fixtureCombinationMismatch = clone(journey);
  fixtureCombinationMismatch.fixtureEvidence.accounts[0].journeyId = "dashboard";
  rehashFixture(fixtureCombinationMismatch.fixtureEvidence);
  expectInvalid(fixtureCombinationMismatch, "fixture journey mismatch", "canonical account order");

  const noncanonicalScreenshot = clone(journey);
  noncanonicalScreenshot.journeys[0].screenshot.path = "artifacts/screenshots/missing.png";
  expectInvalid(noncanonicalScreenshot, "noncanonical screenshot", "fixed canonical PNG path");

  const missingScreenshot = clone(journey);
  missingScreenshot.journeys[0].screenshot.path = "artifacts/missing/screenshots/desktop-login.png";
  expectInvalid(missingScreenshot, "missing screenshot", "missing or unreadable");

  const traversal = clone(journey);
  traversal.journeys[0].screenshot.path = "../screenshots/desktop-login.png";
  expectInvalid(traversal, "screenshot traversal", "canonical, repo-relative");

  const canonicalPath = journey.journeys[0].screenshot.path as string;
  const canonicalAbsolute = path.join(root, canonicalPath);
  const canonicalBytes = viewportPng.desktop;
  const fakePng = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  writeFileSync(canonicalAbsolute, fakePng, { mode: 0o600 });
  const fakePngEvidence = clone(journey);
  fakePngEvidence.journeys[0].screenshot.sha256 = hash(fakePng);
  expectInvalid(fakePngEvidence, "pseudo PNG", "complete PNG");
  writeFileSync(canonicalAbsolute, canonicalBytes, { mode: 0o600 });

  writeFileSync(canonicalAbsolute, viewportPng.mobile, { mode: 0o600 });
  const wrongDimensions = clone(journey);
  wrongDimensions.journeys[0].screenshot.sha256 = hash(viewportPng.mobile);
  expectInvalid(wrongDimensions, "PNG dimension mismatch", "PNG IHDR dimensions");
  writeFileSync(canonicalAbsolute, canonicalBytes, { mode: 0o600 });

  const linkParent = path.join(artifactsDir, "linked");
  mkdirSync(linkParent, { recursive: true });
  symlinkSync("../screenshots", path.join(linkParent, "screenshots"));
  const symlinkedScreenshot = clone(journey);
  symlinkedScreenshot.journeys[0].screenshot.path = "artifacts/linked/screenshots/desktop-login.png";
  expectInvalid(symlinkedScreenshot, "screenshot symlink", "symlink");

  symlinkSync("journey.json", path.join(root, "journey-link.json"));
  expectInvalidResult(validateV11BrowserEvidenceFile("journey-link.json", binding), "evidence symlink", "symlink");
  expectInvalidResult(validateV11BrowserEvidenceFile(path.join(root, "journey.json"), binding), "absolute evidence path", "canonical, repo-relative");

  const firstObservationPath = accessibility.checks[0].artifact.path as string;
  writeFileSync(path.join(root, firstObservationPath), `${JSON.stringify({ tampered: true })}\n`, { mode: 0o600 });
  expectInvalidResult(validateV11BrowserEvidenceFile("accessibility.json", binding), "observation bytes tamper", "current observation file bytes");

  writeFileSync(canonicalAbsolute, Buffer.concat([canonicalBytes, Buffer.from("tampered")]), { mode: 0o600 });
  expectInvalidResult(validateV11BrowserEvidenceFile("journey.json", binding), "screenshot bytes tamper", "current screenshot bytes");

  console.log("v11 browser evidence validator selftest passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function buildJourneyEvidence(fixtureEvidence: MutableRecord): MutableRecord {
  const identity = runtimeIdentity(expectedCommit);
  const journeys = V11_VIEWPORTS.flatMap((viewportId) => V11_JOURNEY_IDS.map((journeyId, journeyIndex) => {
    const viewport = { id: viewportId, ...V11_VIEWPORT_CONTRACT[viewportId] };
    const contract = V11_JOURNEY_CONTRACTS[journeyId];
    const id = `${viewportId}-${journeyId}`;
    const screenshotPath = `artifacts/screenshots/${id}.png`;
    const bytes = viewportPng[viewportId];
    writeFileSync(path.join(root, screenshotPath), bytes, { mode: 0o600 });
    const index = journeyIndex + (viewportId === "mobile" ? 9 : 0);
    const startedAt = new Date(Date.parse("2026-07-29T01:00:00.000Z") + index * 2_000).toISOString();
    const finishedAt = new Date(Date.parse(startedAt) + 1_000).toISOString();
    const account = fixtureEvidence.accounts[index];
    return {
      id,
      journey: journeyId,
      viewport,
      accountRef: account.accountRef,
      startPath: materializeRoute(contract.startPath),
      terminalPath: materializeRoute(contract.terminalPath),
      mutation: {
        initiatedBy: "page-ui",
        uiOriginatedMutation: true,
        method: contract.mutation.method,
        path: materializeRoute(contract.mutation.path),
        status: contract.mutation.status,
        requestCount: contract.mutation.requestCount,
      },
      oracle: {
        method: "GET",
        path: contract.oraclePath,
        before: {
          status: contract.beforeStatus,
          responseSha256: canonicalSha256({ id, state: "before" }),
          assertions: assertionsFor(contract.beforeAssertions),
        },
        after: {
          status: contract.afterStatus,
          responseSha256: canonicalSha256({ id, state: "after" }),
          assertions: assertionsFor(contract.afterAssertions),
        },
      },
      terminalAssertions: assertionsFor(contract.terminalAssertions),
      screenshot: {
        path: screenshotPath,
        sha256: hash(bytes),
        width: viewport.width,
        height: viewport.height,
        syntheticContent: true,
      },
      telemetry: {
        consoleErrors: [], pageErrors: [], requestFailures: [], httpFailures: [], unexplainedFailureCount: 0,
      },
      startedAt,
      finishedAt,
      durationMs: 1_000,
      result: "pass",
    };
  }));
  return {
    schemaVersion: V11_JOURNEY_SCHEMA,
    generatedAt: "2026-07-29T02:00:00.000Z",
    environment: environment(),
    runtimeIdentityEvidence: runtimeEvidence(identity),
    fixtureEvidence: clone(fixtureEvidence),
    summary: {
      total: 18, passed: 18, failed: 0, skipped: 0, desktop: 9, mobile: 9,
      uiOriginatedMutations: 18, getOnlyOracles: 18, unexplainedFailureCount: 0,
    },
    journeys,
    doesNotProve: [...V11_DOES_NOT_PROVE],
    safetyFacts: safetyFacts(),
  };
}

function buildAccessibilityEvidence(fixtureEvidence: MutableRecord): MutableRecord {
  const identity = runtimeIdentity(expectedCommit);
  const checks = V11_ACCESSIBILITY_CHECK_IDS.map((id) => {
    const contract = V11_ACCESSIBILITY_CHECK_CONTRACTS[id];
    const base = {
      id,
      checkKey: contract.checkKey,
      category: contract.category,
      route: materializeRoute(contract.route),
      target: contract.target,
      profile: V11_ACCESSIBILITY_PROFILE_CONTRACT[contract.profile],
      mechanism: contract.mechanism,
      assertions: assertionsFor(contract.assertions),
    };
    const observationPath = `artifacts/a11y-${id.toLowerCase()}.json`;
    const observation = {
      schemaVersion: V11_ACCESSIBILITY_OBSERVATION_SCHEMA,
      recordedAt: "2026-07-29T01:59:30.000Z",
      checkId: id,
      checkKey: base.checkKey,
      route: base.route,
      target: base.target,
      profile: base.profile,
      mechanism: base.mechanism,
      assertions: base.assertions,
    };
    const observationBytes = Buffer.from(`${JSON.stringify(observation, null, 2)}\n`, "utf8");
    writeFileSync(path.join(root, observationPath), observationBytes, { mode: 0o600 });
    return {
      ...base,
      artifact: {
        kind: artifactKind(contract.category),
        path: observationPath,
        sha256: hash(observationBytes),
        observationCount: base.assertions.length,
      },
      result: "pass",
    };
  });
  return {
    schemaVersion: V11_ACCESSIBILITY_SCHEMA,
    generatedAt: "2026-07-29T02:00:00.000Z",
    environment: environment(),
    runtimeIdentityEvidence: runtimeEvidence(identity),
    fixtureEvidence: clone(fixtureEvidence),
    summary: {
      total: 24, passed: 24, failed: 0, skipped: 0,
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
    safetyFacts: safetyFacts(),
  };
}

function assertionsFor(contracts: readonly V11AssertionContract[]): V11Assertion[] {
  return contracts.map((contract) => {
    const expected = expectedValue(contract);
    let actual: V11Assertion["actual"] = clone(expected);
    if (contract.predicate === "between-inclusive") {
      const range = expected as { min: number; max: number };
      actual = (range.min + range.max) / 2;
    }
    return { id: contract.id, predicate: contract.predicate, expected, actual, passed: true };
  });
}

function expectedValue(contract: V11AssertionContract): V11Assertion["expected"] {
  if (contract.expected.kind === "literal") return clone(contract.expected.value);
  if (contract.expected.kind === "integer") {
    if (contract.id === "native-window-width-fixed") return 1440;
    if (contract.id === "native-window-height-fixed") return 1000;
    return Math.max(contract.expected.min, 1);
  }
  if (contract.expected.kind === "route") return "/knowledge/canvas?view=list&subjectId=fixture-subject";
  return contract.id.includes("relation") ? "prerequisite" : "fixture-subject";
}

function runtimeIdentity(gitCommit: string): V11RuntimeIdentity {
  const stored = createStoredRuntimeIdentity({
    appVersion: expectedVersion,
    gitCommit,
    sourceFingerprintSchema: "ux-source-v2",
    productExperienceSourceHash: expectedSourceHash,
    buildId: canonicalSha256({ build: gitCommit }),
    runtimeMode: "production-build",
  });
  return {
    ...stored,
    sourceFingerprintSchema: "ux-source-v2",
    runtimeMode: "production-build",
    observedAt: "2026-07-29T01:59:00.000Z",
    reasonCode: "NONE",
  };
}

function runtimeEvidence(runtimeIdentityValue: V11RuntimeIdentity): MutableRecord {
  return {
    request: { method: "GET", path: "/api/health", status: 200 },
    runtimeIdentity: runtimeIdentityValue,
    responseSha256: computeRuntimeResponseHash(runtimeIdentityValue),
  };
}

function fixture(): MutableRecord {
  const accounts = [
    ...V11_VIEWPORTS.flatMap((viewport) => V11_JOURNEY_IDS.map((journeyId) => ({
      accountRef: canonicalSha256({ account: `${viewport}-${journeyId}` }),
      purpose: "journey" as const,
      viewport,
      journeyId,
    }))),
    {
      accountRef: canonicalSha256({ account: "accessibility-suite" }),
      purpose: "accessibility" as const,
      viewport: "suite" as const,
      journeyId: null,
    },
  ];
  const projection: Omit<V11FixtureEvidence, "manifestSha256"> = {
    schemaVersion: V11_FIXTURE_SCHEMA,
    fixtureSetId: "browser-fixture-20260729",
    generatedAt: "2026-07-29T01:58:00.000Z",
    contentClassification: "synthetic-only",
    isolation: "one-user-per-viewport-journey",
    journeyAccountCount: 18,
    accessibilityAccountCount: 1,
    accounts,
  };
  return { ...projection, manifestSha256: computeFixtureManifestHash(projection) };
}

function rehashFixture(value: MutableRecord): void {
  const projection = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "manifestSha256"));
  value.manifestSha256 = computeFixtureManifestHash(projection as Omit<V11FixtureEvidence, "manifestSha256">);
}

function environment(): MutableRecord {
  return {
    kind: "local-production-mode",
    baseUrl: "http://127.0.0.1:3107",
    browserName: "chrome",
    browserVersion: "127.0.0.1",
    playwrightVersion: "1.62.0",
  };
}

function safetyFacts(): MutableRecord {
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

function artifactKind(category: ReturnType<typeof categoryForCheck>): string {
  return {
    keyboard: "keyboard-trace",
    focus: "focus-trace",
    semantics: "accessibility-tree",
    live: "live-region-trace",
    color: "computed-style",
    zoom: "reflow-measurement",
    canvas: "canvas-equivalence",
  }[category ?? "keyboard"];
}

function materializeRoute(template: string): string {
  return template
    .replace(":sessionId", "fixture-session")
    .replace(":reportId", "fixture-report")
    .replace(":examId", "fixture-exam")
    .replace(":noteId", "fixture-note");
}

function buildPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rows = Buffer.alloc((width + 1) * height);
  const idat = deflateSync(rows, { level: 9 });
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function expectValid(value: { valid: boolean; issues: unknown[] }, label: string): void {
  if (!value.valid) throw new Error(`${label} failed: ${JSON.stringify(value.issues)}`);
}
function expectInvalid(value: MutableRecord, label: string, needle: string): void {
  expectInvalidResult(validateV11BrowserEvidence(value, binding), label, needle);
}
function expectInvalidResult(value: { valid: boolean; issues: unknown[] }, label: string, needle: string): void {
  if (value.valid) throw new Error(`${label} should fail`);
  if (!JSON.stringify(value.issues).includes(needle)) throw new Error(`${label} failed for the wrong reason: ${JSON.stringify(value.issues)}`);
}
function writeJson(relative: string, value: unknown): void {
  writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
function hash(value: Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function clone<T>(value: T): T { return structuredClone(value); }
