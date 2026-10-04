import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  GOVERNANCE_DOES_NOT_PROVE,
  GOVERNANCE_SCENARIOS,
  GOVERNANCE_SCHEMA,
  addIssue,
  buildExpectedBinding,
  exactKeys,
  finishResult,
  isRecord,
  readG8JsonFile,
  readG8Screenshot,
  rereadUnchanged,
  requireInteger,
  requireIso,
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
  "summary", "results", "screenshotEvidence", "doesNotProve",
] as const;
const SUMMARY_KEYS = [
  "total", "passed", "failed", "consoleErrorCount", "pageErrorCount", "failedRequestCount",
  "unexpectedErrorResponseCount", "expectedErrorResponseCount", "result",
] as const;
const RESULT_KEYS = [
  "id", "viewport", "facts", "screenshots", "consoleErrors", "pageErrors", "failedRequests",
  "errorResponses", "expectedErrorResponses", "passed", "failure",
] as const;
const TELEMETRY_KEYS = ["consoleErrors", "pageErrors", "failedRequests", "errorResponses"] as const;
const EXPECTED_SAFETY = {
  loopbackOnly: true,
  authentication: "local-demo-button",
  businessWrites: false,
  mutationRequests: "route-intercepted",
  migration: false,
  productionTouched: false,
} as const;

export type WebGovernanceBrowserInteractionsValidationResult = G8ValidationResult;

export function validateWebGovernanceBrowserInteractions(
  value: unknown,
  binding: G8EvidenceBinding,
): WebGovernanceBrowserInteractionsValidationResult {
  const issues: G8ValidationIssue[] = [];
  const screenshots: G8ScreenshotEvidence[] = [];
  if (!isRecord(value)) return finishResult(null, 0, [{ field: "record", message: "must be a JSON object" }]);
  if (value.schemaVersion !== GOVERNANCE_SCHEMA) {
    addIssue(issues, "schemaVersion", `must be ${GOVERNANCE_SCHEMA}`);
    return finishResult(null, 0, issues);
  }
  exactKeys(value, TOP_KEYS, "record", issues);
  validateRunIdentity(value.runId, "governance-g8-", issues);
  const generatedAt = validateEvidenceTimestamp(value.generatedAt, binding, issues);
  const identity = validateCommonBinding(value, binding, issues, generatedAt);
  validateEnvironment(value.environment, identity, generatedAt, issues);
  if (!identity) validateArtifactBinding(value.binding, binding, null, issues);
  validateSafety(value.safety, EXPECTED_SAFETY, issues);
  validateDoesNotProve(value.doesNotProve, GOVERNANCE_DOES_NOT_PROVE, issues);
  const results = validateResults(value.results, value.runId, binding.root, screenshots, issues);
  validateSummary(value.summary, results, issues);
  if (typeof value.runId === "string") {
    validateExpectedScreenshotDirectory(binding.root, value.runId, GOVERNANCE_SCENARIOS.map((scenario) => scenario.screenshot), issues);
  }
  validateScreenshotDeclarations(value.screenshotEvidence, screenshots, binding.root, value.runId, issues);
  if (results.length === GOVERNANCE_SCENARIOS.length && results.some((entry) => entry.passed !== true)) {
    addIssue(issues, "results", "every governance scenario must pass");
  }
  return finishResult(GOVERNANCE_SCHEMA, Array.isArray(value.results) ? value.results.length : 0, issues, screenshots);
}

export function validateWebGovernanceBrowserInteractionsFile(
  evidencePath: string,
  binding: G8EvidenceBinding,
): WebGovernanceBrowserInteractionsValidationResult {
  const loaded = readG8JsonFile(binding.root, evidencePath);
  if (!loaded.file || !loaded.file.value) return finishResult(null, 0, loaded.issues);
  const result = validateWebGovernanceBrowserInteractions(loaded.file.value, binding);
  const issues = [...loaded.issues, ...result.issues];
  rereadUnchanged(binding.root, loaded.file.relativePath, loaded.file.sha256, issues);
  return finishResult(result.schemaVersion, result.itemCount, issues, result.screenshots);
}

function validateResults(
  raw: unknown,
  runId: unknown,
  root: string,
  screenshots: G8ScreenshotEvidence[],
  issues: G8ValidationIssue[],
): JsonRecord[] {
  if (!Array.isArray(raw)) {
    addIssue(issues, "results", "must contain exactly 7 scenarios");
    return [];
  }
  if (raw.length !== GOVERNANCE_SCENARIOS.length) addIssue(issues, "results", "must contain exactly 7 scenarios");
  const rows: JsonRecord[] = [];
  raw.slice(0, 30).forEach((entry, index) => {
    const field = `results[${index}]`;
    if (!isRecord(entry)) {
      addIssue(issues, field, "must be an object");
      return;
    }
    rows.push(entry);
    exactKeys(entry, RESULT_KEYS, field, issues);
    const expected = GOVERNANCE_SCENARIOS[index];
    if (!expected) {
      addIssue(issues, field, "contains an unexpected scenario");
      return;
    }
    if (entry.id !== expected.id) addIssue(issues, `${field}.id`, "must use canonical scenario order");
    if (entry.viewport !== expected.viewport) addIssue(issues, `${field}.viewport`, "must match the fixed scenario viewport");
    validateFacts(expected.id, entry.facts, `${field}.facts`, issues);
    if (!Array.isArray(entry.screenshots) || entry.screenshots.length !== 1) {
      addIssue(issues, `${field}.screenshots`, "must contain exactly one screenshot");
    } else if (typeof runId === "string") {
      const expectedPath = `output/playwright/${runId}/screenshots/${expected.screenshot}`;
      const [width, height] = parseViewport(expected.viewport);
      // Nested scenario declarations are validated independently; the canonical inventory
      // is collected from top-level screenshotEvidence to avoid double-counting paths.
      readG8Screenshot(root, entry.screenshots[0], expectedPath, `${field}.screenshots[0]`, width, height, true, [], issues);
    }
    validateTelemetry(entry, field, issues);
    validateExpectedResponses(expected.id, entry.expectedErrorResponses, field, issues);
    if (entry.failure !== null) addIssue(issues, `${field}.failure`, "must be null for admissible evidence");
    if (entry.passed !== true) addIssue(issues, `${field}.passed`, "must be true for admissible evidence");
  });
  return rows;
}

function validateTelemetry(entry: JsonRecord, field: string, issues: G8ValidationIssue[]): void {
  for (const key of TELEMETRY_KEYS) {
    if (!Array.isArray(entry[key]) || entry[key].length !== 0) addIssue(issues, `${field}.${key}`, "must be an empty array (telemetry must be zero)");
  }
}

function validateExpectedResponses(id: string, raw: unknown, field: string, issues: G8ValidationIssue[]): void {
  if (!Array.isArray(raw)) {
    addIssue(issues, `${field}.expectedErrorResponses`, "must be an array");
    return;
  }
  if (id !== "resource-409-input-retention") {
    if (raw.length !== 0) addIssue(issues, `${field}.expectedErrorResponses`, "must be empty outside the intentional 409 scenario");
    return;
  }
  if (raw.length !== 1 || typeof raw[0] !== "string" || !/^409 PATCH http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(?:43171|43172|43173)\/api\/study-resources\/test-resource-link$/.test(raw[0])) {
    addIssue(issues, `${field}.expectedErrorResponses`, "must contain exactly the intercepted 409 PATCH response");
  }
}

function validateFacts(id: string, raw: unknown, field: string, issues: G8ValidationIssue[]): void {
  if (!isRecord(raw)) {
    addIssue(issues, field, "must be an object");
    return;
  }
  if (id === "overlay-escape-focus") {
    exactKeys(raw, ["drawerEscapeClosed", "drawerFocusRestored", "windowEscapeMinimized", "windowFocusRestored", "dockVisible"], field, issues);
    for (const key of ["drawerEscapeClosed", "drawerFocusRestored", "windowEscapeMinimized", "windowFocusRestored", "dockVisible"]) if (raw[key] !== true) addIssue(issues, `${field}.${key}`, "must be true");
    return;
  }
  if (id === "draft-current" || id === "draft-stale" || id === "draft-legacy") {
    exactKeys(raw, ["status", "storageKeyPrefix", "restoredValue", "baseRevision", "conflictRequired", "submitLockedBeforeResolution"], field, issues);
    const expectedStatus = id.replace("draft-", "");
    const marker = `G8-${expectedStatus}-draft`;
    if (raw.status !== expectedStatus) addIssue(issues, `${field}.status`, `must be ${expectedStatus}`);
    if (raw.storageKeyPrefix !== "areaforge.resource.draft.detail.") addIssue(issues, `${field}.storageKeyPrefix`, "must use the canonical resource draft key prefix");
    if (raw.restoredValue !== marker) addIssue(issues, `${field}.restoredValue`, "must prove the expected local draft was restored");
    requireInteger(raw.baseRevision, `${field}.baseRevision`, issues, 0, 1_000_000);
    const conflict = expectedStatus !== "current";
    if (raw.conflictRequired !== conflict) addIssue(issues, `${field}.conflictRequired`, "must match current/stale/legacy semantics");
    if (raw.submitLockedBeforeResolution !== conflict) addIssue(issues, `${field}.submitLockedBeforeResolution`, "must match current/stale/legacy semantics");
    return;
  }
  if (id === "resource-409-input-retention") {
    exactKeys(raw, ["interceptedStatus", "submittedTitle", "retainedTitle", "conflictFields", "automaticOverwrite"], field, issues);
    if (raw.interceptedStatus !== 409) addIssue(issues, `${field}.interceptedStatus`, "must be 409");
    if (raw.submittedTitle !== "G8 本机冲突输入必须保留" || raw.retainedTitle !== raw.submittedTitle) addIssue(issues, field, "must retain the local title after the 409 response");
    if (JSON.stringify(raw.conflictFields) !== JSON.stringify(["revision", "title"])) addIssue(issues, `${field}.conflictFields`, "must identify revision and title");
    if (raw.automaticOverwrite !== false) addIssue(issues, `${field}.automaticOverwrite`, "must be false");
    return;
  }
  if (id === "ai-latest-wins") {
    exactKeys(raw, ["previewRequestCount", "duplicateClickRequestCount", "requestTexts", "visiblePreview", "stalePreviewVisible", "pendingLocked"], field, issues);
    if (raw.previewRequestCount !== 2 || raw.duplicateClickRequestCount !== 1) addIssue(issues, field, "must report two preview requests and one suppressed duplicate click");
    if (JSON.stringify(raw.requestTexts) !== JSON.stringify(["G8 FIRST", "G8 SECOND"])) addIssue(issues, `${field}.requestTexts`, "must preserve request input order");
    if (raw.visiblePreview !== "G8_SECOND_PREVIEW" || raw.stalePreviewVisible !== false || raw.pendingLocked !== true) addIssue(issues, field, "must prove latest-wins and pending lock semantics");
    return;
  }
  if (id === "upload-batch-lock") {
    exactKeys(raw, ["stageRequestCount", "resolveRequestCount", "originalFileName", "pendingControlsLocked", "pendingSubmitControl", "duplicateClickSuppressed", "resolvedSnapshot"], field, issues);
    if (raw.stageRequestCount !== 1 || raw.resolveRequestCount !== 1) addIssue(issues, field, "must report one staging and one resolve request");
    if (raw.originalFileName !== "governance-original.md") addIssue(issues, `${field}.originalFileName`, "must preserve the frozen file name");
    if (raw.pendingControlsLocked !== true || raw.duplicateClickSuppressed !== true) addIssue(issues, field, "must prove the upload batch lock");
    if (raw.pendingSubmitControl !== "disabled" && raw.pendingSubmitControl !== "unmounted") addIssue(issues, `${field}.pendingSubmitControl`, "must be disabled or unmounted while pending");
    if (!isRecord(raw.resolvedSnapshot)) {
      addIssue(issues, `${field}.resolvedSnapshot`, "must contain the frozen resolve request");
    } else {
      exactKeys(raw.resolvedSnapshot, ["attachmentId", "decision", "title", "subjectId", "category", "tags"], `${field}.resolvedSnapshot`, issues);
      if (raw.resolvedSnapshot.attachmentId !== "g8-staged-attachment" || !["copy", "skip"].includes(String(raw.resolvedSnapshot.decision)) || raw.resolvedSnapshot.title !== "governance-original.md" || raw.resolvedSnapshot.subjectId !== null || raw.resolvedSnapshot.category !== "COURSE" || JSON.stringify(raw.resolvedSnapshot.tags) !== JSON.stringify(["alpha", "beta"])) addIssue(issues, `${field}.resolvedSnapshot`, "must match the frozen upload metadata snapshot");
    }
    return;
  }
  addIssue(issues, field, "unknown governance scenario");
}

function validateSummary(raw: unknown, results: JsonRecord[], issues: G8ValidationIssue[]): void {
  if (!isRecord(raw)) {
    addIssue(issues, "summary", "must be an object");
    return;
  }
  exactKeys(raw, SUMMARY_KEYS, "summary", issues);
  const expected = {
    total: results.length,
    passed: results.filter((item) => item.passed === true).length,
    failed: results.filter((item) => item.passed !== true).length,
    consoleErrorCount: sumArrays(results, "consoleErrors"),
    pageErrorCount: sumArrays(results, "pageErrors"),
    failedRequestCount: sumArrays(results, "failedRequests"),
    unexpectedErrorResponseCount: sumArrays(results, "errorResponses"),
    expectedErrorResponseCount: sumArrays(results, "expectedErrorResponses"),
    result: results.length === GOVERNANCE_SCENARIOS.length && results.every((item) => item.passed === true) ? "PASS" : "FAIL",
  } as const;
  for (const key of SUMMARY_KEYS) if (raw[key] !== expected[key]) addIssue(issues, `summary.${key}`, "must equal the value derived from results");
  if (raw.result !== "PASS") addIssue(issues, "summary.result", "must be PASS for admissible browser evidence");
  if (raw.consoleErrorCount !== 0 || raw.pageErrorCount !== 0 || raw.failedRequestCount !== 0 || raw.unexpectedErrorResponseCount !== 0) addIssue(issues, "summary", "telemetry counts must all be zero");
}

function sumArrays(results: JsonRecord[], key: string): number {
  return results.reduce((total, item) => total + (Array.isArray(item[key]) ? item[key].length : 0), 0);
}

function validateScreenshotDeclarations(
  raw: unknown,
  actual: G8ScreenshotEvidence[],
  root: string,
  runId: unknown,
  issues: G8ValidationIssue[],
): void {
  const expectedPaths = typeof runId === "string"
    ? GOVERNANCE_SCENARIOS.map((scenario) => `output/playwright/${runId}/screenshots/${scenario.screenshot}`)
    : [];
  if (!Array.isArray(raw) || raw.length !== expectedPaths.length) {
    addIssue(issues, "screenshotEvidence", `must contain exactly ${expectedPaths.length} declared screenshots`);
    return;
  }
  raw.forEach((entry, index) => {
    const [width, height] = parseViewport(GOVERNANCE_SCENARIOS[index]?.viewport ?? "1x1");
    readG8Screenshot(root, entry, expectedPaths[index] ?? "", `screenshotEvidence[${index}]`, width, height, true, actual, issues);
  });
  if (actual.length !== expectedPaths.length) addIssue(issues, "screenshotEvidence", "all canonical screenshots must be readable");
}

function parseViewport(value: string): [number, number] {
  const match = /^(\d+)x(\d+)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2])] : [1, 1];
}

function currentBinding(root: string): { commit: string; version: string; sourceHash: string } {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string };
  return { commit: currentGitCommit(root), version: packageJson.version ?? "", sourceHash: computeProductExperienceSourceHash(root) };
}

function main(): void {
  const usage = "Usage: pnpm exec tsx scripts/quality/web-governance-browser-interactions-validate.ts <evidence.json> [--expected-commit <sha>] [--expected-version <version>] [--expected-source-hash <sha>]";
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
    const result = validateWebGovernanceBrowserInteractionsFile(evidencePath, binding);
    if (!result.valid) {
      for (const issue of result.issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
      console.error(`FAIL web-governance-browser-interactions-validate ${result.issues.length} issue(s)`);
      process.exitCode = 1;
      return;
    }
    console.log(`PASS web-governance-browser-interactions-validate ${result.schemaVersion} (${result.itemCount} scenarios; ${result.screenshots.length} screenshots hashed)`);
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
