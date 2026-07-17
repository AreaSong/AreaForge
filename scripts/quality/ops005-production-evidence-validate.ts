import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseIndentedKeyValueRecord,
  parseList,
  readRequiredFile,
  requireField,
  requireIsoTimestamp,
  requireNo,
  requireOneOf,
  requireSha256,
  scanForSecrets,
  sha256,
  type ValidationIssue,
} from "./record-validator-common";
import {
  validateReleaseSupplyChainRecord,
  type ReleaseSupplyChainValidationOptions,
} from "./release-supply-chain-validate";

const requiredValidationCommands = [
  "pnpm ops:ops-005:local:selftest",
  "pnpm ops:ops-005:preflight:selftest",
  "pnpm ops:ops-005:evidence:selftest",
  "pnpm shellcheck:updater",
  "pnpm github-release-updater:preflight",
  "pnpm check",
];

const requiredDoesNotProve = [
  "AF-RISK-OPS-005 residual closure",
  "production business write safety beyond scoped V2 check",
  "OPS-001 closure",
  "secrets absence beyond validator scan",
];

const requiredFields = [
  "recordId",
  "recordedAt",
  "environment",
  "releaseTag",
  "packageVersion",
  "gitCommit",
  "webImageDigest",
  "updateAgentScriptSha256",
  "updaterScriptSha256",
  "localImplementationStatus",
  "localValidationCommands",
  "signedReleaseStatus",
  "productionDeploymentStatus",
  "timerPausedBeforeDeployment",
  "legacyMutationQueueDisposition",
  "webAgentVersionMatch",
  "v2CheckStatus",
  "v2CheckRequestHash",
  "expectedBeforeRejectionStatus",
  "expectedBeforeRejectionExecutionAttempted",
  "expectedBeforeRejectionRequestHash",
  "expectedBeforeRejectionEvidenceFile",
  "expectedBeforeRejectionEvidenceHash",
  "operationalEvidenceFile",
  "operationalEvidenceHash",
  "sharedProductionStateLockStatus",
  "processingReconciliationStatus",
  "autoApply",
  "redactedDecisionHistoryHash",
  "redactedDecisionHistoryFile",
  "evidenceFreshnessMaxAgeHours",
  "residualRiskIds",
  "doesNotProve",
  "safetyFacts.secretValuePrinted",
  "safetyFacts.productionBusinessDataWritten",
  "safetyFacts.residualLedgerUpdated",
  "safetyFacts.webRuntimeServerCommandAttempted",
  "safetyFacts.productionMutationRequestExecuted",
  "safetyFacts.autoApplyPolicyChanged",
  "safetyFacts.databaseRestoreAttempted",
  "safetyFacts.uploadsRestoreAttempted",
] as const;

export type Ops005ValidationOptions = {
  now?: Date;
  maxAgeHours?: number;
  expectedIdentity?: Ops005ExpectedIdentity;
  evidenceBaseDir?: string;
};

export type Ops005EvidenceBundleOptions = Ops005ValidationOptions & {
  releaseAssetsDir?: string;
  cosignPublicKey?: string;
  releaseSignatureVerifier?: ReleaseSupplyChainValidationOptions["verifySignature"];
  root?: string;
  sourceAtCommit?: Ops005SourceAtCommitReader;
};

export type Ops005ExpectedIdentity = {
  packageVersion: string;
  releaseTag: string;
  gitCommit: string;
  webImageDigest: string;
  updateAgentScriptSha256: string;
  updaterScriptSha256: string;
};

export type Ops005SourceAtCommitReader = (gitCommit: string, file: string, root: string) => string;

export function buildOps005ExpectedIdentity(
  releaseRecord: string,
  root = process.cwd(),
  sourceAtCommit: Ops005SourceAtCommitReader = readGitObject,
): Ops005ExpectedIdentity {
  const releaseFields = parseIndentedKeyValueRecord(releaseRecord);
  const gitCommit = releaseFields.get("gitCommit") ?? "";
  return {
    packageVersion: releaseFields.get("packageVersion") ?? "",
    releaseTag: releaseFields.get("releaseTag") ?? "",
    gitCommit,
    webImageDigest: releaseFields.get("webImageDigest") ?? "",
    updateAgentScriptSha256: sourceHash(sourceAtCommit(gitCommit, "ops/update-agent/areaforge-update-agent.sh", root)),
    updaterScriptSha256: sourceHash(sourceAtCommit(gitCommit, "ops/github-release-updater/areaforge-updater.sh", root)),
  };
}

export function validateOps005ProductionEvidence(
  record: string,
  options: Ops005ValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  scanForSecrets(record, issues);
  const fields = parseIndentedKeyValueRecord(record);
  for (const field of requiredFields) requireField(fields, field, issues);

  requireIsoTimestamp(fields, "recordedAt", issues);
  for (const field of [
    "localImplementationStatus",
    "signedReleaseStatus",
    "productionDeploymentStatus",
    "v2CheckStatus",
    "expectedBeforeRejectionStatus",
    "sharedProductionStateLockStatus",
    "processingReconciliationStatus",
  ]) {
    requireOneOf(fields, field, ["pass"], issues);
  }
  requireOneOf(fields, "environment", ["production"], issues);
  requireOneOf(fields, "timerPausedBeforeDeployment", ["yes"], issues);
  requireOneOf(fields, "legacyMutationQueueDisposition", ["empty", "isolated"], issues);
  requireOneOf(fields, "webAgentVersionMatch", ["yes"], issues);
  requireOneOf(fields, "autoApply", ["none"], issues);

  for (const field of [
    "updateAgentScriptSha256",
    "updaterScriptSha256",
    "v2CheckRequestHash",
    "expectedBeforeRejectionEvidenceHash",
    "operationalEvidenceHash",
    "redactedDecisionHistoryHash",
    "expectedBeforeRejectionRequestHash",
  ]) {
    requireSha256(fields, field, issues);
  }
  for (const field of [
    "expectedBeforeRejectionExecutionAttempted",
    "safetyFacts.secretValuePrinted",
    "safetyFacts.productionBusinessDataWritten",
    "safetyFacts.residualLedgerUpdated",
    "safetyFacts.webRuntimeServerCommandAttempted",
    "safetyFacts.productionMutationRequestExecuted",
    "safetyFacts.autoApplyPolicyChanged",
    "safetyFacts.databaseRestoreAttempted",
    "safetyFacts.uploadsRestoreAttempted",
  ]) {
    requireNo(fields, field, issues);
  }

  const packageVersion = fields.get("packageVersion") ?? "";
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageVersion)) {
    issues.push({ field: "packageVersion", message: "must be a semantic version without v prefix" });
  }
  if (fields.get("releaseTag") !== `v${packageVersion}`) {
    issues.push({ field: "releaseTag", message: "must equal v + packageVersion" });
  }
  if (!/^[a-f0-9]{40}$/i.test(fields.get("gitCommit") ?? "")) {
    issues.push({ field: "gitCommit", message: "must be a 40-character git commit" });
  }
  if (!/^ghcr\.io\/areasong\/areaforge-web:v?[^@]+@sha256:[a-f0-9]{64}$/i.test(fields.get("webImageDigest") ?? "")) {
    issues.push({ field: "webImageDigest", message: "must be an immutable AreaForge GHCR web image digest" });
  }

  const commands = parseList(fields.get("localValidationCommands") ?? "");
  for (const command of requiredValidationCommands) {
    if (!commands.includes(command)) issues.push({ field: "localValidationCommands", message: `missing ${command}` });
  }
  const residualIds = parseList(fields.get("residualRiskIds") ?? "");
  if (!residualIds.includes("AF-RISK-OPS-005")) {
    issues.push({ field: "residualRiskIds", message: "must include AF-RISK-OPS-005" });
  }
  const nonProofs = parseList(fields.get("doesNotProve") ?? "");
  for (const value of requiredDoesNotProve) {
    if (!nonProofs.includes(value)) issues.push({ field: "doesNotProve", message: `missing ${value}` });
  }

  validateFreshness(fields, options, issues);
  validateExpectedIdentity(fields, options.expectedIdentity, issues);
  validateEvidenceFiles(fields, options, issues);
  return issues;
}

export function validateOps005ProductionEvidenceBundle(
  record: string,
  releaseRecord: string,
  options: Ops005EvidenceBundleOptions = {},
): ValidationIssue[] {
  const releaseIssues = validateReleaseSupplyChainRecord(releaseRecord, {
    assetDir: options.releaseAssetsDir,
    strict: true,
    cosignPublicKey: options.cosignPublicKey,
    verifySignature: options.releaseSignatureVerifier,
  }).map((issue) => ({ field: `release.${issue.field}`, message: issue.message }));
  const expectedIdentity = buildOps005ExpectedIdentity(
    releaseRecord,
    options.root ?? process.cwd(),
    options.sourceAtCommit,
  );
  return [
    ...releaseIssues,
    ...validateOps005ProductionEvidence(record, { ...options, expectedIdentity }),
  ];
}

function validateEvidenceFiles(
  fields: Map<string, string>,
  options: Ops005ValidationOptions,
  issues: ValidationIssue[],
): void {
  if (!options.evidenceBaseDir) {
    issues.push({ field: "evidenceBaseDir", message: "is required to bind OPS-005 evidence files" });
    return;
  }
  const rejection = readBoundEvidence(
    options.evidenceBaseDir,
    fields.get("expectedBeforeRejectionEvidenceFile") ?? "",
    fields.get("expectedBeforeRejectionEvidenceHash") ?? "",
    "expectedBeforeRejectionEvidenceFile",
    issues,
  );
  const history = readBoundEvidence(
    options.evidenceBaseDir,
    fields.get("redactedDecisionHistoryFile") ?? "",
    fields.get("redactedDecisionHistoryHash") ?? "",
    "redactedDecisionHistoryFile",
    issues,
  );
  const operational = readBoundEvidence(
    options.evidenceBaseDir,
    fields.get("operationalEvidenceFile") ?? "",
    fields.get("operationalEvidenceHash") ?? "",
    "operationalEvidenceFile",
    issues,
  );
  if (rejection) validateRejectionEvidence(rejection, fields, issues);
  if (history) validateDecisionHistoryEvidence(history, fields, issues);
  if (operational) validateOperationalEvidence(operational, fields, issues);
}

function readBoundEvidence(
  baseDir: string,
  relativeFile: string,
  recordedHash: string,
  field: string,
  issues: ValidationIssue[],
): unknown | null {
  if (!relativeFile || path.isAbsolute(relativeFile) || relativeFile.split(/[\\/]+/).includes("..")) {
    issues.push({ field, message: "must be a safe relative evidence path" });
    return null;
  }
  const base = path.resolve(baseDir);
  const absolute = path.resolve(base, relativeFile);
  if (absolute !== base && !absolute.startsWith(`${base}${path.sep}`)) {
    issues.push({ field, message: "must remain inside the evidence directory" });
    return null;
  }
  if (!existsSync(absolute)) {
    issues.push({ field, message: "evidence file does not exist" });
    return null;
  }
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    issues.push({ field, message: "must be a regular non-symlink file" });
    return null;
  }
  const realBase = realpathSync(base);
  const realFile = realpathSync(absolute);
  if (realFile !== realBase && !realFile.startsWith(`${realBase}${path.sep}`)) {
    issues.push({ field, message: "must not escape through a symlinked parent" });
    return null;
  }
  const raw = readFileSync(realFile, "utf8");
  const actualHash = `sha256:${sha256(raw)}`;
  if (recordedHash !== actualHash) issues.push({ field: field.replace("File", "Hash"), message: "must match evidence file content" });
  scanForSecrets(raw, issues);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    issues.push({ field, message: "must contain valid JSON" });
    return null;
  }
}

function validateRejectionEvidence(value: unknown, fields: Map<string, string>, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "expectedBeforeRejectionEvidenceFile", message: "must contain a JSON object" });
    return;
  }
  validateEvidenceIdentity(value, fields, "expectedBeforeRejectionEvidenceFile", issues);
  const expected: Record<string, unknown> = {
    schemaVersion: 1,
    mode: "redacted_ops005_expected_before_rejection",
    requestHash: fields.get("expectedBeforeRejectionRequestHash"),
    reasonCode: "EXPECTED_BEFORE_MISMATCH",
    decision: "REJECTED",
    executionAttempted: false,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) issues.push({ field: `expectedBeforeRejectionEvidenceFile.${key}`, message: `must equal ${String(expectedValue)}` });
  }
}

function validateDecisionHistoryEvidence(value: unknown, fields: Map<string, string>, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "redactedDecisionHistoryFile", message: "must contain a JSON object" });
    return;
  }
  validateEvidenceIdentity(value, fields, "redactedDecisionHistoryFile", issues);
  if (value.schemaVersion !== 1 || value.mode !== "redacted_ops005_decision_history") {
    issues.push({ field: "redactedDecisionHistoryFile", message: "must use the OPS-005 decision history schema" });
  }
  const decisions = Array.isArray(value.decisions) ? value.decisions.filter(isRecord) : [];
  const requestHash = fields.get("expectedBeforeRejectionRequestHash");
  if (!decisions.some((decision) => decision.requestHash === requestHash && decision.reasonCode === "EXPECTED_BEFORE_MISMATCH" && decision.decision === "REJECTED" && decision.executionAttempted === false)) {
    issues.push({ field: "redactedDecisionHistoryFile.decisions", message: "must contain the bound zero-execution expected-before rejection" });
  }
  const checkRequestHash = fields.get("v2CheckRequestHash");
  if (!decisions.some((decision) => decision.schemaVersion === 2 && decision.action === "check" &&
    decision.requestHash === checkRequestHash && decision.reasonCode === "CHECK_COMPLETED" &&
    decision.decision === "SUCCEEDED" && decision.executionAttempted === false)) {
    issues.push({ field: "redactedDecisionHistoryFile.decisions", message: "must contain the bound successful zero-execution V2 check" });
  }
}

function validateOperationalEvidence(value: unknown, fields: Map<string, string>, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "operationalEvidenceFile", message: "must contain a JSON object" });
    return;
  }
  validateEvidenceIdentity(value, fields, "operationalEvidenceFile", issues);
  if (value.schemaVersion !== 1 || value.mode !== "redacted_ops005_operational_evidence") {
    issues.push({ field: "operationalEvidenceFile", message: "must use the OPS-005 operational evidence schema" });
  }
  if (value.autoApply !== fields.get("autoApply")) {
    issues.push({ field: "operationalEvidenceFile.autoApply", message: "must match the production evidence record" });
  }

  const deployment = asRecord(value.productionDeployment);
  const expectedQueueDisposition = fields.get("legacyMutationQueueDisposition");
  if (deployment.status !== fields.get("productionDeploymentStatus") ||
    deployment.timerPausedBeforeDeployment !== (fields.get("timerPausedBeforeDeployment") === "yes") ||
    deployment.legacyMutationQueueDisposition !== expectedQueueDisposition ||
    deployment.webAgentVersionMatch !== (fields.get("webAgentVersionMatch") === "yes")) {
    issues.push({ field: "operationalEvidenceFile.productionDeployment", message: "must bind deployment, timer, queue, and Web/agent facts" });
  }

  const check = asRecord(value.v2Check);
  if (check.status !== fields.get("v2CheckStatus") || check.schemaVersion !== 2 || check.action !== "check" ||
    check.requestHash !== fields.get("v2CheckRequestHash") || check.decision !== "SUCCEEDED" || check.executionAttempted !== false) {
    issues.push({ field: "operationalEvidenceFile.v2Check", message: "must bind the successful zero-execution V2 check" });
  }

  const sharedLock = asRecord(value.sharedProductionStateLock);
  if (sharedLock.status !== fields.get("sharedProductionStateLockStatus") ||
    sharedLock.updaterInheritedLockVerified !== true || sharedLock.mutationOverlapObserved !== false) {
    issues.push({ field: "operationalEvidenceFile.sharedProductionStateLock", message: "must bind inherited-lock verification and zero overlap" });
  }

  const reconciliation = asRecord(value.processingReconciliation);
  if (reconciliation.status !== fields.get("processingReconciliationStatus") ||
    reconciliation.staleMutationReplayObserved !== false || reconciliation.blockerProjectionVerified !== true ||
    reconciliation.readonlyCheckAllowed !== true) {
    issues.push({ field: "operationalEvidenceFile.processingReconciliation", message: "must bind replay prevention, blocker projection, and read-only check behavior" });
  }
}

function validateEvidenceIdentity(
  value: Record<string, unknown>,
  fields: Map<string, string>,
  field: string,
  issues: ValidationIssue[],
): void {
  for (const key of ["releaseTag", "packageVersion", "gitCommit", "webImageDigest"]) {
    if (value[key] !== fields.get(key)) issues.push({ field: `${field}.${key}`, message: "must match the production evidence record identity" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function validateExpectedIdentity(
  fields: Map<string, string>,
  expected: Ops005ExpectedIdentity | undefined,
  issues: ValidationIssue[],
): void {
  if (!expected) return;
  for (const field of [
    "packageVersion",
    "releaseTag",
    "gitCommit",
    "webImageDigest",
    "updateAgentScriptSha256",
    "updaterScriptSha256",
  ] as const) {
    if (!expected[field] || fields.get(field) !== expected[field]) {
      issues.push({ field, message: "must match the signed Release identity and current checkout source hash" });
    }
  }
}

function sourceHash(source: string): string {
  return source ? `sha256:${sha256(source)}` : "";
}

function readGitObject(gitCommit: string, file: string, root: string): string {
  if (!/^[a-f0-9]{40}$/i.test(gitCommit)) return "";
  try {
    return execFileSync("git", ["show", `${gitCommit}:${file}`], { cwd: root, encoding: "utf8" });
  } catch {
    return "";
  }
}

function validateFreshness(
  fields: Map<string, string>,
  options: Ops005ValidationOptions,
  issues: ValidationIssue[],
): void {
  const recordMaxAge = Number(fields.get("evidenceFreshnessMaxAgeHours"));
  if (!Number.isFinite(recordMaxAge) || recordMaxAge <= 0 || recordMaxAge > 168) {
    issues.push({ field: "evidenceFreshnessMaxAgeHours", message: "must be between 1 and 168" });
    return;
  }
  const maxAgeHours = options.maxAgeHours ?? recordMaxAge;
  const recordedAt = new Date(fields.get("recordedAt") ?? "");
  if (Number.isNaN(recordedAt.getTime())) return;
  const ageHours = ((options.now ?? new Date()).getTime() - recordedAt.getTime()) / 3_600_000;
  if (ageHours < -0.5) issues.push({ field: "recordedAt", message: "must not be more than 30 minutes in the future" });
  if (ageHours > maxAgeHours) issues.push({ field: "recordedAt", message: `evidence is stale; age ${ageHours.toFixed(1)}h exceeds ${maxAgeHours}h` });
}

function main(): void {
  const recordPath = process.argv[2];
  const releaseRecordPath = process.argv[3];
  const releaseAssetsDir = process.argv[4] ?? process.env.AREAFORGE_OPS005_RELEASE_ASSETS_DIR?.trim();
  if (!recordPath || !releaseRecordPath || !releaseAssetsDir) {
    console.error("Usage: pnpm ops:ops-005:evidence:validate <record> <release-record> <release-assets-dir>");
    process.exit(2);
  }
  const raw = readRequiredFile(path.resolve(recordPath));
  const releaseRecord = readRequiredFile(path.resolve(releaseRecordPath));
  const issues = validateOps005ProductionEvidenceBundle(raw, releaseRecord, {
    now: process.env.AREAFORGE_OPS005_NOW ? new Date(process.env.AREAFORGE_OPS005_NOW) : undefined,
    maxAgeHours: process.env.AREAFORGE_OPS005_MAX_AGE_HOURS
      ? Number(process.env.AREAFORGE_OPS005_MAX_AGE_HOURS)
      : undefined,
    evidenceBaseDir: path.dirname(path.resolve(recordPath)),
    releaseAssetsDir: path.resolve(releaseAssetsDir),
    cosignPublicKey: process.env.AREAFORGE_COSIGN_PUBLIC_KEY?.trim() ||
      path.join(process.cwd(), "docs/deployment/keys/areaforge-cosign.pub"),
  });
  if (issues.length > 0) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    console.error(`OPS-005 production evidence validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }
  console.log("OPS-005 production evidence validation passed: strict signed Release assets and the bound production evidence record are ready for human review.");
  console.log(`ops005ProductionEvidenceRecordHash: sha256:${sha256(raw)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
