import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";
import { validateRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-core";
import {
  V11_ACCESSIBILITY_CATEGORIES,
  V11_ACCESSIBILITY_CHECK_IDS,
  V11_ACCESSIBILITY_CHECK_CONTRACTS,
  V11_ACCESSIBILITY_OBSERVATION_SCHEMA,
  V11_ACCESSIBILITY_PROFILE_CONTRACT,
  V11_ACCESSIBILITY_SCHEMA,
  V11_CATEGORY_COUNTS,
  V11_DOES_NOT_PROVE,
  V11_EVIDENCE_KEYS,
  V11_FIXTURE_SCHEMA,
  V11_JOURNEY_IDS,
  V11_JOURNEY_CONTRACTS,
  V11_JOURNEY_SCHEMA,
  V11_VIEWPORT_CONTRACT,
  V11_VIEWPORTS,
  canonicalSha256,
  categoryForCheck,
  canonicalV11JourneyScreenshotName,
  containsV11SecretLikeText,
  computeFixtureManifestHash,
  computeRuntimeResponseHash,
  isV11Commit,
  isV11RedactedValue,
  isV11Sha256,
  isV11ShortToken,
  isV11Version,
  matchesV11AssertionExpectedContract,
  parseV11BrowserEvidenceCli,
  readV11PngDimensions,
  readV11SafeRepoFile,
  safeV11Error,
  type V11AccessibilityCategory,
  type V11AssertionContract,
  type V11EvidenceBinding,
  type V11EvidenceSchema,
  type V11EvidenceValidationResult,
  type V11FixtureEvidence,
  type V11FixtureAccount,
  type V11RuntimeIdentity,
  type V11ValidationIssue,
} from "./v11-browser-evidence-contract";
import {
  computeProductExperienceSourceHash,
  currentGitCommit,
  findWorkspaceRoot,
} from "./product-experience-source";

type JsonRecord = Record<string, unknown>;

const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
const MAX_OBSERVATION_BYTES = 1024 * 1024;
const {
  TOP_COMMON, ENVIRONMENT: ENVIRONMENT_KEYS, RUNTIME: RUNTIME_KEYS, REQUEST: REQUEST_KEYS,
  FIXTURE: FIXTURE_KEYS, SAFETY: SAFETY_KEYS, JOURNEY: JOURNEY_KEYS, VIEWPORT: VIEWPORT_KEYS,
  FIXTURE_ACCOUNT: FIXTURE_ACCOUNT_KEYS,
  MUTATION: MUTATION_KEYS, ORACLE: ORACLE_KEYS, ORACLE_STATE: ORACLE_STATE_KEYS,
  ASSERTION: ASSERTION_KEYS, SCREENSHOT: SCREENSHOT_KEYS, TELEMETRY: TELEMETRY_KEYS,
  A11Y_CHECK: A11Y_CHECK_KEYS, PROFILE: PROFILE_KEYS, ARTIFACT: ARTIFACT_KEYS,
  OBSERVATION: OBSERVATION_KEYS, CATEGORY_SUMMARY: CATEGORY_SUMMARY_KEYS,
} = V11_EVIDENCE_KEYS;

export function validateV11BrowserEvidenceFile(
  evidencePath: string,
  binding: V11EvidenceBinding,
): V11EvidenceValidationResult {
  let file;
  try {
    file = readV11SafeRepoFile(binding.root, evidencePath, MAX_EVIDENCE_BYTES);
  } catch (error) {
    return result(null, 0, [{ field: "recordPath", message: safeV11Error(error) }]);
  }
  if (!file.relativePath.endsWith(".json")) {
    return result(null, 0, [{ field: "recordPath", message: "must be a repo-relative .json file" }]);
  }
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes); }
  catch { return result(null, 0, [{ field: "record", message: "must use valid UTF-8" }]); }
  const issues: V11ValidationIssue[] = [];
  if (containsV11SecretLikeText(raw)) issue(issues, "record", "must not contain secret-like text");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    issues.push({ field: "record", message: "must contain valid JSON" });
    return result(null, 0, issues);
  }
  const validated = validateV11BrowserEvidence(value, binding);
  try {
    const finalRead = readV11SafeRepoFile(binding.root, evidencePath, MAX_EVIDENCE_BYTES);
    if (finalRead.sha256 !== file.sha256) issues.push({ field: "recordPath", message: "evidence file changed during validation" });
  } catch (error) {
    issues.push({ field: "recordPath", message: safeV11Error(error) });
  }
  return result(validated.schemaVersion, validated.itemCount, [...issues, ...validated.issues]);
}

/** Returns all contract issues without logging or mutating process state. */
export function validateV11BrowserEvidence(
  value: unknown,
  binding: V11EvidenceBinding,
): V11EvidenceValidationResult {
  const issues: V11ValidationIssue[] = [];
  validateBinding(binding, issues);
  if (!isRecord(value)) {
    issues.push({ field: "record", message: "must be a JSON object" });
    return result(null, 0, issues);
  }
  if (containsV11SecretLikeText(JSON.stringify(value))) issue(issues, "record", "must not contain secret-like text");
  if (value.schemaVersion === V11_JOURNEY_SCHEMA) {
    validateJourneyEvidence(value, binding, issues);
    return result(V11_JOURNEY_SCHEMA, Array.isArray(value.journeys) ? value.journeys.length : 0, issues);
  }
  if (value.schemaVersion === V11_ACCESSIBILITY_SCHEMA) {
    validateAccessibilityEvidence(value, binding, issues);
    return result(V11_ACCESSIBILITY_SCHEMA, Array.isArray(value.checks) ? value.checks.length : 0, issues);
  }
  issues.push({ field: "schemaVersion", message: `must be ${V11_JOURNEY_SCHEMA} or ${V11_ACCESSIBILITY_SCHEMA}` });
  return result(null, 0, issues);
}

function validateJourneyEvidence(value: JsonRecord, binding: V11EvidenceBinding, issues: V11ValidationIssue[]): void {
  exactKeys(value, [...TOP_COMMON, "journeys"], "record", issues);
  validateCommon(value, binding, issues);
  const expectedSummary = {
    total: 18, passed: 18, failed: 0, skipped: 0, desktop: 9, mobile: 9,
    uiOriginatedMutations: 18, getOnlyOracles: 18, unexplainedFailureCount: 0,
  };
  validateExactSummary(value.summary, expectedSummary, "summary", issues);
  if (!Array.isArray(value.journeys)) return issue(issues, "journeys", "must contain exactly 18 items");
  if (value.journeys.length !== 18) issues.push({ field: "journeys", message: "must contain exactly 18 items" });
  const combinations = new Set<string>();
  const accounts = new Set<string>();
  const screenshots = new Set<string>();
  value.journeys.slice(0, 100).forEach((item, index) => validateJourney(item, index, binding, issues, combinations, accounts, screenshots));
  const expected = V11_VIEWPORTS.flatMap((viewport) => V11_JOURNEY_IDS.map((journey) => `${viewport}:${journey}`));
  for (const [index, combination] of expected.entries()) {
    if (!combinations.has(combination)) issues.push({ field: "journeys", message: `missing required item ${combination}` });
    if (isRecord(value.journeys[index]) && value.journeys[index].id !== combination.replace(":", "-")) issue(issues, `journeys[${index}].id`, "items must use canonical desktop-then-mobile journey order");
  }
  if (accounts.size !== 18) issues.push({ field: "journeys.accountRef", message: "must use 18 distinct synthetic account references" });
  validateJourneyFixtureBinding(value.journeys, value.fixtureEvidence, issues);
}

function validateJourney(
  raw: unknown,
  index: number,
  binding: V11EvidenceBinding,
  issues: V11ValidationIssue[],
  combinations: Set<string>,
  accounts: Set<string>,
  screenshots: Set<string>,
): void {
  const field = `journeys[${index}]`;
  if (!isRecord(raw)) return issue(issues, field, "must be an object");
  exactKeys(raw, JOURNEY_KEYS, field, issues);
  const journey = string(raw.journey);
  const viewportId = isRecord(raw.viewport) ? string(raw.viewport.id) : null;
  const contract = journey && V11_JOURNEY_IDS.includes(journey as never)
    ? V11_JOURNEY_CONTRACTS[journey as keyof typeof V11_JOURNEY_CONTRACTS]
    : null;
  if (!contract) issue(issues, `${field}.journey`, "must be a required journey ID");
  validateViewport(raw.viewport, `${field}.viewport`, issues);
  if (journey && viewportId) {
    const combination = `${viewportId}:${journey}`;
    if (combinations.has(combination)) issue(issues, field, `duplicate journey/viewport ${combination}`);
    combinations.add(combination);
    if (raw.id !== `${viewportId}-${journey}`) issue(issues, `${field}.id`, "must equal <viewport>-<journey>");
  }
  if (!validSha(raw.accountRef)) issue(issues, `${field}.accountRef`, "must be a non-zero sha256 reference");
  else accounts.add(raw.accountRef as string);
  validateContractRoute(raw.startPath, contract?.startPath ?? null, `${field}.startPath`, issues);
  validateContractRoute(raw.terminalPath, contract?.terminalPath ?? null, `${field}.terminalPath`, issues);
  validateMutation(raw.mutation, contract?.mutation ?? null, `${field}.mutation`, issues);
  validateOracle(raw.oracle, contract, `${field}.oracle`, issues);
  validateAssertions(raw.terminalAssertions, contract?.terminalAssertions ?? null, `${field}.terminalAssertions`, issues);
  validateScreenshot(raw.screenshot, raw.viewport, journey, viewportId, `${field}.screenshot`, binding, issues, screenshots);
  validateTelemetry(raw.telemetry, `${field}.telemetry`, issues);
  validateTiming(raw, field, issues);
  if (raw.result !== "pass") issue(issues, `${field}.result`, "must be pass; skip/fail is not admissible");
}

function validateMutation(
  raw: unknown,
  contract: (typeof V11_JOURNEY_CONTRACTS)[keyof typeof V11_JOURNEY_CONTRACTS]["mutation"] | null,
  field: string,
  issues: V11ValidationIssue[],
): void {
  if (!isRecord(raw)) return issue(issues, field, "must be an object");
  exactKeys(raw, MUTATION_KEYS, field, issues);
  if (raw.initiatedBy !== "page-ui" || raw.uiOriginatedMutation !== true) {
    issue(issues, field, "must be initiated by page-ui with uiOriginatedMutation=true");
  }
  if (!contract || raw.method !== contract.method) issue(issues, `${field}.method`, "must match the fixed journey mutation method");
  validateContractRoute(raw.path, contract?.path ?? null, `${field}.path`, issues);
  if (!contract || raw.status !== contract.status) issue(issues, `${field}.status`, "must match the fixed journey mutation status");
  if (raw.requestCount !== 1 || contract?.requestCount !== 1) issue(issues, `${field}.requestCount`, "must be exactly 1");
}

function validateOracle(
  raw: unknown,
  contract: (typeof V11_JOURNEY_CONTRACTS)[keyof typeof V11_JOURNEY_CONTRACTS] | null,
  field: string,
  issues: V11ValidationIssue[],
): void {
  if (!isRecord(raw)) return issue(issues, field, "must be an object");
  exactKeys(raw, ORACLE_KEYS, field, issues);
  if (raw.method !== "GET") issue(issues, `${field}.method`, "must be GET-only");
  validateContractRoute(raw.path, contract?.oraclePath ?? null, `${field}.path`, issues);
  validateOracleState(raw.before, contract?.beforeStatus ?? null, contract?.beforeAssertions ?? null, `${field}.before`, issues);
  validateOracleState(raw.after, contract?.afterStatus ?? null, contract?.afterAssertions ?? null, `${field}.after`, issues);
  if (isRecord(raw.before) && isRecord(raw.after) && raw.before.responseSha256 === raw.after.responseSha256) {
    issue(issues, field, "before and after response hashes must differ");
  }
}

function validateOracleState(
  raw: unknown,
  expectedStatus: number | null,
  assertionContract: readonly V11AssertionContract[] | null,
  field: string,
  issues: V11ValidationIssue[],
): void {
  if (!isRecord(raw)) return issue(issues, field, "must be an object");
  exactKeys(raw, ORACLE_STATE_KEYS, field, issues);
  if (expectedStatus === null || raw.status !== expectedStatus) issue(issues, `${field}.status`, "must match the fixed GET oracle status");
  if (!validSha(raw.responseSha256)) issue(issues, `${field}.responseSha256`, "must be a non-zero sha256 digest");
  validateAssertions(raw.assertions, assertionContract, `${field}.assertions`, issues);
}

function validateScreenshot(
  raw: unknown,
  viewport: unknown,
  journey: string | null,
  viewportId: string | null,
  field: string,
  binding: V11EvidenceBinding,
  issues: V11ValidationIssue[],
  screenshots: Set<string>,
): void {
  if (!isRecord(raw)) return issue(issues, field, "must be an object");
  exactKeys(raw, SCREENSHOT_KEYS, field, issues);
  if (raw.syntheticContent !== true) issue(issues, `${field}.syntheticContent`, "must be true");
  if (!integerIn(raw.width, 1, 20_000) || !integerIn(raw.height, 1, 100_000)) issue(issues, field, "width and height must be positive integers");
  if (isRecord(viewport) && (raw.width !== viewport.width || raw.height !== viewport.height)) issue(issues, field, "declared dimensions must exactly match the fixed viewport");
  const screenshotPath = string(raw.path);
  const canonicalName = journey && viewportId
    && V11_JOURNEY_IDS.includes(journey as never) && V11_VIEWPORTS.includes(viewportId as never)
    ? canonicalV11JourneyScreenshotName(viewportId as keyof typeof V11_VIEWPORT_CONTRACT, journey as keyof typeof V11_JOURNEY_CONTRACTS)
    : null;
  if (!screenshotPath || !canonicalName || path.posix.basename(screenshotPath) !== canonicalName
    || path.posix.basename(path.posix.dirname(screenshotPath)) !== "screenshots") {
    issue(issues, `${field}.path`, "must use the fixed canonical PNG path screenshots/<viewport>-<journey>.png");
    return;
  }
  if (screenshots.has(screenshotPath)) issue(issues, `${field}.path`, "must be unique for each journey/viewport item");
  screenshots.add(screenshotPath);
  try {
    const file = readV11SafeRepoFile(binding.root, screenshotPath, MAX_ARTIFACT_BYTES);
    if (raw.sha256 !== file.sha256) issue(issues, `${field}.sha256`, "does not match the current screenshot bytes");
    const dimensions = readV11PngDimensions(file.bytes);
    if (dimensions.width !== raw.width || dimensions.height !== raw.height) issue(issues, field, "PNG IHDR dimensions must match the declaration");
    if (isRecord(viewport) && (dimensions.width !== viewport.width || dimensions.height !== viewport.height)) {
      issue(issues, field, "PNG IHDR dimensions must exactly match the fixed viewport");
    }
  } catch (error) {
    issue(issues, `${field}.path`, safeV11Error(error));
  }
}

function validateTelemetry(raw: unknown, field: string, issues: V11ValidationIssue[]): void {
  if (!isRecord(raw)) return issue(issues, field, "must be an object");
  exactKeys(raw, TELEMETRY_KEYS, field, issues);
  for (const key of ["consoleErrors", "pageErrors", "requestFailures", "httpFailures"] as const) {
    if (!Array.isArray(raw[key]) || raw[key].length !== 0) issue(issues, `${field}.${key}`, "must be an empty array");
  }
  if (raw.unexplainedFailureCount !== 0) issue(issues, `${field}.unexplainedFailureCount`, "must be 0");
}

function validateTiming(raw: JsonRecord, field: string, issues: V11ValidationIssue[]): void {
  const start = timestamp(raw.startedAt, `${field}.startedAt`, issues);
  const finish = timestamp(raw.finishedAt, `${field}.finishedAt`, issues);
  if (!integerIn(raw.durationMs, 1, 3_600_000)) issue(issues, `${field}.durationMs`, "must be an integer from 1 to 3600000");
  if (start !== null && finish !== null && finish < start) issue(issues, field, "finishedAt must not precede startedAt");
  if (start !== null && finish !== null && typeof raw.durationMs === "number" && Math.abs(finish - start - raw.durationMs) > 1_000) {
    issue(issues, `${field}.durationMs`, "must match startedAt/finishedAt within 1000ms");
  }
}

function validateAccessibilityEvidence(value: JsonRecord, binding: V11EvidenceBinding, issues: V11ValidationIssue[]): void {
  exactKeys(value, [...TOP_COMMON, "checks"], "record", issues);
  validateCommon(value, binding, issues);
  validateAccessibilitySummary(value.summary, issues);
  if (!Array.isArray(value.checks)) return issue(issues, "checks", "must contain exactly 24 checks");
  if (value.checks.length !== 24) issues.push({ field: "checks", message: "must contain exactly 24 checks" });
  const ids = new Set<string>();
  const artifactPaths = new Set<string>();
  const generatedAt = typeof value.generatedAt === "string" ? Date.parse(value.generatedAt) : Number.NaN;
  value.checks.slice(0, 100).forEach((check, index) => validateAccessibilityCheck(
    check,
    index,
    ids,
    artifactPaths,
    binding,
    Number.isNaN(generatedAt) ? null : generatedAt,
    issues,
  ));
  for (const [index, id] of V11_ACCESSIBILITY_CHECK_IDS.entries()) {
    if (!ids.has(id)) issue(issues, "checks", `missing required ID ${id}`);
    if (isRecord(value.checks[index]) && value.checks[index].id !== id) issue(issues, `checks[${index}].id`, "checks must use canonical required-ID order");
  }
}

function validateAccessibilityCheck(
  raw: unknown,
  index: number,
  ids: Set<string>,
  artifactPaths: Set<string>,
  binding: V11EvidenceBinding,
  generatedAt: number | null,
  issues: V11ValidationIssue[],
): void {
  const field = `checks[${index}]`;
  if (!isRecord(raw)) return issue(issues, field, "must be an object");
  exactKeys(raw, A11Y_CHECK_KEYS, field, issues);
  const id = string(raw.id);
  if (!id || !V11_ACCESSIBILITY_CHECK_IDS.includes(id as never)) issue(issues, `${field}.id`, "must be a required accessibility ID");
  else if (ids.has(id)) issue(issues, `${field}.id`, `duplicate check ${id}`);
  else ids.add(id);
  const contract = id && V11_ACCESSIBILITY_CHECK_IDS.includes(id as never)
    ? V11_ACCESSIBILITY_CHECK_CONTRACTS[id as keyof typeof V11_ACCESSIBILITY_CHECK_CONTRACTS]
    : null;
  if (!contract || raw.checkKey !== contract.checkKey) issue(issues, `${field}.checkKey`, "must match the stable check contract");
  if (!contract || raw.target !== contract.target) issue(issues, `${field}.target`, "must match the stable check target");
  const category = string(raw.category);
  if (!contract || category !== contract.category || category !== categoryForCheck(id ?? "")) issue(issues, `${field}.category`, "must match the fixed check category");
  validateContractRoute(raw.route, contract?.route ?? null, `${field}.route`, issues);
  validateAccessibilityProfile(raw.profile, contract?.profile ?? null, `${field}.profile`, issues);
  if (!contract || raw.mechanism !== contract.mechanism) issue(issues, `${field}.mechanism`, "must match the fixed check mechanism");
  const assertionCount = validateAssertions(raw.assertions, contract?.assertions ?? null, `${field}.assertions`, issues);
  validateAccessibilityArtifact(raw, contract?.assertions ?? null, assertionCount, field, artifactPaths, binding, generatedAt, issues);
  if (raw.result !== "pass") issue(issues, `${field}.result`, "must be pass; skip/fail is not admissible");
}

function validateAccessibilityArtifact(
  raw: JsonRecord,
  assertionContract: readonly V11AssertionContract[] | null,
  assertionCount: number,
  field: string,
  artifactPaths: Set<string>,
  binding: V11EvidenceBinding,
  generatedAt: number | null,
  issues: V11ValidationIssue[],
): void {
  const artifactField = `${field}.artifact`;
  if (!isRecord(raw.artifact)) return issue(issues, artifactField, "must be an object");
  exactKeys(raw.artifact, ARTIFACT_KEYS, artifactField, issues);
  const expectedKinds: Record<string, string> = {
    keyboard: "keyboard-trace", focus: "focus-trace", semantics: "accessibility-tree",
    live: "live-region-trace", color: "computed-style", zoom: "reflow-measurement", canvas: "canvas-equivalence",
  };
  if (raw.artifact.kind !== expectedKinds[string(raw.category) ?? ""]) issue(issues, `${artifactField}.kind`, "must match the category artifact kind");
  if (raw.artifact.observationCount !== assertionCount) issue(issues, `${artifactField}.observationCount`, "must equal the assertion count");
  const artifactPath = string(raw.artifact.path);
  if (!artifactPath || !artifactPath.endsWith(".json")) {
    issue(issues, `${artifactField}.path`, "must be a repo-relative JSON observation file");
    return;
  }
  if (artifactPaths.has(artifactPath)) issue(issues, `${artifactField}.path`, "must be unique for every accessibility check");
  artifactPaths.add(artifactPath);
  let file;
  try {
    file = readV11SafeRepoFile(binding.root, artifactPath, MAX_OBSERVATION_BYTES);
  } catch (error) {
    issue(issues, `${artifactField}.path`, safeV11Error(error));
    return;
  }
  if (raw.artifact.sha256 !== file.sha256) issue(issues, `${artifactField}.sha256`, "must match the current observation file bytes");
  let observation: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
    if (containsV11SecretLikeText(text)) issue(issues, `${artifactField}.path`, "must not contain secret-like text");
    observation = JSON.parse(text);
  } catch {
    issue(issues, `${artifactField}.path`, "must contain valid UTF-8 JSON");
    return;
  }
  if (!isRecord(observation)) {
    issue(issues, `${artifactField}.path`, "must contain a JSON object");
    return;
  }
  exactKeys(observation, OBSERVATION_KEYS, `${artifactField}.observation`, issues);
  if (observation.schemaVersion !== V11_ACCESSIBILITY_OBSERVATION_SCHEMA) issue(issues, `${artifactField}.observation.schemaVersion`, `must be ${V11_ACCESSIBILITY_OBSERVATION_SCHEMA}`);
  for (const [observationKey, checkKey] of [
    ["checkId", "id"],
    ["checkKey", "checkKey"],
    ["route", "route"],
    ["target", "target"],
    ["mechanism", "mechanism"],
  ] as const) {
    if (observation[observationKey] !== raw[checkKey]) issue(issues, `${artifactField}.observation.${observationKey}`, `must match check.${checkKey}`);
  }
  if (JSON.stringify(observation.profile) !== JSON.stringify(raw.profile)) issue(issues, `${artifactField}.observation.profile`, "must match the check profile");
  if (JSON.stringify(observation.assertions) !== JSON.stringify(raw.assertions)) issue(issues, `${artifactField}.observation.assertions`, "must match the check assertions exactly");
  validateAssertions(observation.assertions, assertionContract, `${artifactField}.observation.assertions`, issues);
  const recordedAt = timestamp(observation.recordedAt, `${artifactField}.observation.recordedAt`, issues);
  if (generatedAt !== null && recordedAt !== null && Math.abs(generatedAt - recordedAt) > 2 * 60 * 60_000) {
    issue(issues, `${artifactField}.observation.recordedAt`, "must be within two hours of the evidence generatedAt timestamp");
  }
}

function validateAccessibilityProfile(
  raw: unknown,
  expectedId: keyof typeof V11_ACCESSIBILITY_PROFILE_CONTRACT | null,
  field: string,
  issues: V11ValidationIssue[],
): void {
  if (!isRecord(raw)) return issue(issues, field, "must be an object");
  exactKeys(raw, PROFILE_KEYS, field, issues);
  if (!expectedId || JSON.stringify(raw) !== JSON.stringify(V11_ACCESSIBILITY_PROFILE_CONTRACT[expectedId])) {
    issue(issues, field, "must match the fixed accessibility profile contract");
  }
}

function validateAccessibilitySummary(raw: unknown, issues: V11ValidationIssue[]): void {
  if (!isRecord(raw)) return issue(issues, "summary", "must be an object");
  exactKeys(raw, ["total", "passed", "failed", "skipped", "categories"], "summary", issues);
  for (const [key, expected] of Object.entries({ total: 24, passed: 24, failed: 0, skipped: 0 })) {
    if (raw[key] !== expected) issue(issues, `summary.${key}`, `must be ${expected}`);
  }
  if (!Array.isArray(raw.categories) || raw.categories.length !== 7) {
    return issue(issues, "summary.categories", "must contain exactly seven category summaries");
  }
  raw.categories.forEach((entry, index) => {
    const field = `summary.categories[${index}]`;
    if (!isRecord(entry)) return issue(issues, field, "must be an object");
    exactKeys(entry, CATEGORY_SUMMARY_KEYS, field, issues);
    const category = V11_ACCESSIBILITY_CATEGORIES[index];
    const count = V11_CATEGORY_COUNTS[category];
    if (entry.category !== category) issue(issues, `${field}.category`, `must be ${category}`);
    for (const [key, expected] of Object.entries({ total: count, passed: count, failed: 0, skipped: 0 })) {
      if (entry[key] !== expected) issue(issues, `${field}.${key}`, `must be ${expected}`);
    }
  });
}

function validateCommon(
  value: JsonRecord,
  binding: V11EvidenceBinding,
  issues: V11ValidationIssue[],
): void {
  const generatedAt = timestamp(value.generatedAt, "generatedAt", issues);
  validateEnvironment(value.environment, issues);
  validateRuntime(value.runtimeIdentityEvidence, binding, generatedAt, issues);
  validateFixture(value.fixtureEvidence, generatedAt, issues);
  if (JSON.stringify(value.doesNotProve) !== JSON.stringify(V11_DOES_NOT_PROVE)) {
    issue(issues, "doesNotProve", `must be exactly ${V11_DOES_NOT_PROVE.join(", ")}`);
  }
  validateSafetyFacts(value.safetyFacts, value.environment, issues);
}

function validateEnvironment(raw: unknown, issues: V11ValidationIssue[]): void {
  if (!isRecord(raw)) return issue(issues, "environment", "must be an object");
  exactKeys(raw, ENVIRONMENT_KEYS, "environment", issues);
  if (!["local-production-mode", "staging"].includes(string(raw.kind) ?? "")) issue(issues, "environment.kind", "must be local-production-mode or staging");
  if (!["chrome", "chromium"].includes(string(raw.browserName) ?? "")) issue(issues, "environment.browserName", "must be chrome or chromium");
  for (const key of ["browserVersion", "playwrightVersion"] as const) if (!isV11ShortToken(raw[key])) issue(issues, `environment.${key}`, "must be a short version token");
  let url: URL;
  try { url = new URL(string(raw.baseUrl) ?? ""); } catch { return issue(issues, "environment.baseUrl", "must be a valid origin URL"); }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) issue(issues, "environment.baseUrl", "must be an origin without credentials, path, query, or fragment");
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (raw.kind === "local-production-mode" && (!local || !["http:", "https:"].includes(url.protocol))) issue(issues, "environment.baseUrl", "local evidence must use a loopback origin");
  if (raw.kind === "staging" && (local || url.protocol !== "https:")) issue(issues, "environment.baseUrl", "staging evidence must use a non-loopback HTTPS origin");
}

function validateRuntime(raw: unknown, binding: V11EvidenceBinding, generatedAt: number | null, issues: V11ValidationIssue[]): void {
  if (!isRecord(raw)) return issue(issues, "runtimeIdentityEvidence", "must be an object");
  exactKeys(raw, RUNTIME_KEYS, "runtimeIdentityEvidence", issues);
  if (!isRecord(raw.request)) issue(issues, "runtimeIdentityEvidence.request", "must be an object");
  else {
    exactKeys(raw.request, REQUEST_KEYS, "runtimeIdentityEvidence.request", issues);
    if (raw.request.method !== "GET" || raw.request.path !== "/api/health" || raw.request.status !== 200) issue(issues, "runtimeIdentityEvidence.request", "must be GET /api/health with status 200");
  }
  let identity: V11RuntimeIdentity | null = null;
  try { identity = validateRuntimeIdentity(raw.runtimeIdentity) as V11RuntimeIdentity; }
  catch (error) { issue(issues, "runtimeIdentityEvidence.runtimeIdentity", safeV11Error(error)); }
  if (!identity) return;
  if (identity.runtimeMode !== "production-build") issue(issues, "runtimeIdentityEvidence.runtimeIdentity.runtimeMode", "must be production-build");
  if (identity.gitCommit !== binding.expectedCommit) issue(issues, "runtimeIdentityEvidence.runtimeIdentity.gitCommit", "must match expected commit");
  if (identity.appVersion !== binding.expectedVersion) issue(issues, "runtimeIdentityEvidence.runtimeIdentity.appVersion", "must match expected version");
  if (identity.productExperienceSourceHash !== binding.expectedSourceHash) issue(issues, "runtimeIdentityEvidence.runtimeIdentity.productExperienceSourceHash", "must match expected source hash");
  if (raw.responseSha256 !== computeRuntimeResponseHash(identity)) issue(issues, "runtimeIdentityEvidence.responseSha256", "must bind the canonical health response");
  const observedAt = timestamp(identity.observedAt, "runtimeIdentityEvidence.runtimeIdentity.observedAt", issues);
  if (generatedAt !== null && observedAt !== null && (observedAt > generatedAt + 300_000 || generatedAt - observedAt > 7_200_000)) {
    issue(issues, "runtimeIdentityEvidence.runtimeIdentity.observedAt", "must be within two hours before generatedAt and at most 300 seconds after it");
  }
}

function validateFixture(raw: unknown, evidenceGeneratedAt: number | null, issues: V11ValidationIssue[]): void {
  if (!isRecord(raw)) return issue(issues, "fixtureEvidence", "must be an object");
  exactKeys(raw, FIXTURE_KEYS, "fixtureEvidence", issues);
  if (raw.schemaVersion !== V11_FIXTURE_SCHEMA) issue(issues, "fixtureEvidence.schemaVersion", `must be ${V11_FIXTURE_SCHEMA}`);
  if (!isV11ShortToken(raw.fixtureSetId)) issue(issues, "fixtureEvidence.fixtureSetId", "must be a short opaque token");
  if (raw.contentClassification !== "synthetic-only") issue(issues, "fixtureEvidence.contentClassification", "must be synthetic-only");
  if (raw.isolation !== "one-user-per-viewport-journey") issue(issues, "fixtureEvidence.isolation", "must be one-user-per-viewport-journey");
  if (raw.journeyAccountCount !== 18) issue(issues, "fixtureEvidence.journeyAccountCount", "must be 18");
  if (raw.accessibilityAccountCount !== 1) issue(issues, "fixtureEvidence.accessibilityAccountCount", "must be 1");
  const fixtureGeneratedAt = timestamp(raw.generatedAt, "fixtureEvidence.generatedAt", issues);
  if (evidenceGeneratedAt !== null && fixtureGeneratedAt !== null
    && (fixtureGeneratedAt > evidenceGeneratedAt + 300_000 || evidenceGeneratedAt - fixtureGeneratedAt > 7_200_000)) {
    issue(issues, "fixtureEvidence.generatedAt", "must be within two hours before evidence generatedAt and at most 300 seconds after it");
  }
  validateFixtureAccounts(raw.accounts, issues);
  const projection = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "manifestSha256"));
  const expectedHash = computeFixtureManifestHash(projection as Omit<V11FixtureEvidence, "manifestSha256">);
  if (raw.manifestSha256 !== expectedHash) issue(issues, "fixtureEvidence.manifestSha256", "must bind the canonical fixture manifest");
}

function validateFixtureAccounts(raw: unknown, issues: V11ValidationIssue[]): void {
  if (!Array.isArray(raw) || raw.length !== 19) return issue(issues, "fixtureEvidence.accounts", "must contain exactly 18 journey accounts and one accessibility account");
  const expected = [
    ...V11_VIEWPORTS.flatMap((viewport) => V11_JOURNEY_IDS.map((journeyId) => ({
      purpose: "journey" as const, viewport, journeyId,
    }))),
    { purpose: "accessibility" as const, viewport: "suite" as const, journeyId: null },
  ];
  const accountRefs = new Set<string>();
  raw.forEach((account, index) => {
    const field = `fixtureEvidence.accounts[${index}]`;
    if (!isRecord(account)) return issue(issues, field, "must be an object");
    exactKeys(account, FIXTURE_ACCOUNT_KEYS, field, issues);
    if (!validSha(account.accountRef)) issue(issues, `${field}.accountRef`, "must be a non-zero sha256 reference");
    else if (accountRefs.has(account.accountRef)) issue(issues, `${field}.accountRef`, "must be unique across all 19 fixture accounts");
    else accountRefs.add(account.accountRef);
    const contract = expected[index];
    if (!contract || account.purpose !== contract.purpose) issue(issues, `${field}.purpose`, "must match the canonical account order");
    if (!contract || account.viewport !== contract.viewport) issue(issues, `${field}.viewport`, "must match the canonical account order");
    if (!contract || account.journeyId !== contract.journeyId) issue(issues, `${field}.journeyId`, "must match the canonical account order");
  });
}

function validateJourneyFixtureBinding(journeys: unknown[], fixture: unknown, issues: V11ValidationIssue[]): void {
  if (!isRecord(fixture) || !Array.isArray(fixture.accounts)) return;
  const journeyAccounts = fixture.accounts.filter((account): account is V11FixtureAccount =>
    isRecord(account) && account.purpose === "journey") as unknown as V11FixtureAccount[];
  for (const [index, item] of journeys.slice(0, 18).entries()) {
    if (!isRecord(item)) continue;
    const account = journeyAccounts[index];
    if (!account || item.accountRef !== account.accountRef) issue(issues, `journeys[${index}].accountRef`, "must match the canonical fixture manifest account");
    const viewportId = isRecord(item.viewport) ? item.viewport.id : null;
    if (!account || item.journey !== account.journeyId || viewportId !== account.viewport) {
      issue(issues, `journeys[${index}]`, "journey and viewport must match the canonical fixture manifest account");
    }
  }
  for (const [index, account] of journeyAccounts.entries()) {
    const matches = journeys.filter((item) => isRecord(item)
      && item.accountRef === account.accountRef
      && item.journey === account.journeyId
      && isRecord(item.viewport) && item.viewport.id === account.viewport);
    if (matches.length !== 1) issue(issues, `fixtureEvidence.accounts[${index}]`, "must bind exactly one journey evidence item in both directions");
  }
}

function validateSafetyFacts(raw: unknown, environment: unknown, issues: V11ValidationIssue[]): void {
  if (!isRecord(raw)) return issue(issues, "safetyFacts", "must be an object");
  exactKeys(raw, SAFETY_KEYS, "safetyFacts", issues);
  const local = isRecord(environment) && environment.kind === "local-production-mode";
  if (raw.localBaseUrl !== local || raw.localDatabase !== local) issue(issues, "safetyFacts", "local facts must match the environment kind");
  if (raw.explicitWriteOptIn !== true || raw.passwordSource !== "restricted-file") issue(issues, "safetyFacts", "must retain explicit write opt-in and restricted-file password source");
  for (const key of SAFETY_KEYS.slice(4)) if (raw[key] !== false) issue(issues, `safetyFacts.${key}`, "must be false");
}

function validateViewport(raw: unknown, field: string, issues: V11ValidationIssue[]): void {
  if (!isRecord(raw)) return issue(issues, field, "must be an object");
  exactKeys(raw, VIEWPORT_KEYS, field, issues);
  const id = string(raw.id);
  if (!id || !V11_VIEWPORTS.includes(id as never)) return issue(issues, `${field}.id`, "must be desktop or mobile");
  const expected = V11_VIEWPORT_CONTRACT[id as keyof typeof V11_VIEWPORT_CONTRACT];
  for (const key of ["width", "height", "deviceScaleFactor"] as const) if (raw[key] !== expected[key]) issue(issues, `${field}.${key}`, `must be ${expected[key]}`);
}

function validateAssertions(
  raw: unknown,
  contract: readonly V11AssertionContract[] | null,
  field: string,
  issues: V11ValidationIssue[],
): number {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) {
    issue(issues, field, "must contain 1 to 100 assertions");
    return 0;
  }
  if (contract && raw.length !== contract.length) issue(issues, field, `must contain exactly ${contract.length} fixed assertions`);
  const ids = new Set<string>();
  raw.forEach((assertion, index) => {
    const itemField = `${field}[${index}]`;
    if (!isRecord(assertion)) return issue(issues, itemField, "must be an object");
    exactKeys(assertion, ASSERTION_KEYS, itemField, issues);
    if (!isV11ShortToken(assertion.id)) issue(issues, `${itemField}.id`, "must be a short assertion token");
    else if (ids.has(assertion.id as string)) issue(issues, `${itemField}.id`, "must be unique within the assertion list");
    else ids.add(assertion.id as string);
    if (!isV11RedactedValue(assertion.expected) || !isV11RedactedValue(assertion.actual)) issue(issues, itemField, "expected and actual must be bounded redacted JSON values");
    const expected = contract?.[index];
    if (expected && assertion.id !== expected.id) issue(issues, `${itemField}.id`, "must match the fixed assertion ID and order");
    if (expected && assertion.predicate !== expected.predicate) issue(issues, `${itemField}.predicate`, "must match the fixed assertion predicate");
    if (expected && !matchesV11AssertionExpectedContract(assertion.expected, expected.expected)) issue(issues, `${itemField}.expected`, "must match the fixed assertion expected semantics");
    const computed = recomputeAssertion(assertion.predicate, assertion.expected, assertion.actual);
    if (computed === null) issue(issues, `${itemField}.predicate`, "must be a supported assertion predicate with compatible expected and actual values");
    if (typeof assertion.passed !== "boolean" || assertion.passed !== computed) issue(issues, `${itemField}.passed`, "must equal the result recomputed from predicate, expected, and actual");
    if (computed !== true) issue(issues, `${itemField}.actual`, "does not satisfy the fixed assertion semantics");
  });
  return raw.length;
}

function recomputeAssertion(predicate: unknown, expected: unknown, actual: unknown): boolean | null {
  if (predicate === "equals") return jsonEqual(expected, actual);
  if (predicate === "not-equals") return !jsonEqual(expected, actual);
  if (predicate === "gte") return typeof expected === "number" && Number.isFinite(expected)
    && typeof actual === "number" && Number.isFinite(actual) ? actual >= expected : null;
  if (predicate === "lte") return typeof expected === "number" && Number.isFinite(expected)
    && typeof actual === "number" && Number.isFinite(actual) ? actual <= expected : null;
  if (predicate === "between-inclusive") {
    if (!isRecord(expected) || typeof expected.min !== "number" || !Number.isFinite(expected.min)
      || typeof expected.max !== "number" || !Number.isFinite(expected.max) || expected.min > expected.max
      || typeof actual !== "number" || !Number.isFinite(actual)) return null;
    return actual >= expected.min && actual <= expected.max;
  }
  if (predicate === "contains-all") {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return null;
    return expected.every((needle) => actual.some((candidate) => jsonEqual(needle, candidate)));
  }
  return null;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try { return canonicalSha256(left) === canonicalSha256(right); }
  catch { return false; }
}

function validateExactSummary(raw: unknown, expected: JsonRecord, field: string, issues: V11ValidationIssue[]): void {
  if (!isRecord(raw)) return issue(issues, field, "must be an object");
  exactKeys(raw, Object.keys(expected), field, issues);
  for (const [key, value] of Object.entries(expected)) if (raw[key] !== value) issue(issues, `${field}.${key}`, `must be ${value}`);
}

export { readV11SafeRepoFile as readSafeRepoFile } from "./v11-browser-evidence-contract";

function validateBinding(binding: V11EvidenceBinding, issues: V11ValidationIssue[]): void {
  if (!isV11Commit(binding.expectedCommit)) issue(issues, "expectedCommit", "must be a non-zero 40-character lowercase commit SHA");
  if (!isV11Version(binding.expectedVersion)) issue(issues, "expectedVersion", "must be a semantic version");
  if (!validSha(binding.expectedSourceHash)) issue(issues, "expectedSourceHash", "must be a non-zero sha256 digest");
}

function exactKeys(value: JsonRecord, expected: readonly string[], field: string, issues: V11ValidationIssue[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) issue(issues, field, `keys must be exactly ${[...expected].sort().join(", ")}`);
}

function validateRoute(value: unknown, field: string, issues: V11ValidationIssue[]): void {
  if (!isSameOriginRoute(value)) issue(issues, field, "must be a redacted same-origin absolute path");
}

function validateContractRoute(
  value: unknown,
  template: string | null,
  field: string,
  issues: V11ValidationIssue[],
): void {
  validateRoute(value, field, issues);
  if (!template || typeof value !== "string" || !matchesRouteTemplate(value, template)) {
    issue(issues, field, "must match the fixed route contract");
  }
}

function isSameOriginRoute(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")
    || value.includes("\\") || value.includes("#") || value.length > 500) return false;
  try {
    const url = new URL(value, "http://areaforge.invalid");
    return url.origin === "http://areaforge.invalid" && !url.username && !url.password;
  } catch { return false; }
}

function matchesRouteTemplate(value: string, template: string): boolean {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/:[A-Za-z][A-Za-z0-9]*/g, "[A-Za-z0-9][A-Za-z0-9._~-]{0,119}");
  return new RegExp(`^${pattern}$`).test(value);
}

function timestamp(value: unknown, field: string, issues: V11ValidationIssue[]): number | null {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    issue(issues, field, "must be an ISO-8601 timestamp with timezone");
    return null;
  }
  return Date.parse(value);
}

function validSha(value: unknown): value is string { return isV11Sha256(value); }
function integerIn(value: unknown, min: number, max: number): boolean { return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max; }
function isRecord(value: unknown): value is JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value); }
function string(value: unknown): string | null { return typeof value === "string" ? value : null; }
function issue(issues: V11ValidationIssue[], field: string, message: string): void { if (issues.length < 250) issues.push({ field, message }); }
function result(schemaVersion: V11EvidenceSchema | null, itemCount: number, issues: V11ValidationIssue[]): V11EvidenceValidationResult {
  const unique = [...new Map(issues.map((item) => [`${item.field}\0${item.message}`, item])).values()];
  return { valid: unique.length === 0, schemaVersion, itemCount, issues: unique };
}

function main(): void {
  const usage = "Usage: pnpm exec tsx scripts/quality/v11-browser-evidence-validate.ts <evidence.json> [--expected-commit <sha>] [--expected-version 1.1.0]";
  let cli: ReturnType<typeof parseV11BrowserEvidenceCli>;
  try { cli = parseV11BrowserEvidenceCli(process.argv.slice(2)); }
  catch (error) { console.error(`ERROR ${safeV11Error(error)}`); console.error(usage); process.exitCode = 2; return; }
  let root: string;
  let expectedCommit: string;
  let expectedVersion: string;
  let expectedSourceHash: string;
  try {
    root = findWorkspaceRoot();
    expectedCommit = cli.expectedCommit ?? currentGitCommit(root);
    expectedVersion = cli.expectedVersion ?? (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string }).version ?? "";
    expectedSourceHash = computeProductExperienceSourceHash(root);
  } catch (error) {
    console.error(`ERROR ${safeV11Error(error)}`);
    process.exitCode = 2;
    return;
  }
  const validated = validateV11BrowserEvidenceFile(cli.evidencePath, { root, expectedCommit, expectedVersion, expectedSourceHash });
  if (!validated.valid) {
    for (const item of validated.issues) console.error(`FAIL ${item.field}: ${item.message}`);
    console.error(`FAIL v11-browser-evidence-validate ${validated.issues.length} issue(s)`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS v11-browser-evidence-validate ${validated.schemaVersion}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
