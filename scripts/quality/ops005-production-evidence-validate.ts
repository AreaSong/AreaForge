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

const requiredValidationCommands = [
  "pnpm update-center:request-v2:selftest",
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
  "expectedBeforeRejectionEvidenceHash",
  "sharedProductionStateLockStatus",
  "processingReconciliationStatus",
  "autoApply",
  "redactedDecisionHistoryHash",
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
};

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
    "redactedDecisionHistoryHash",
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
  return issues;
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
  if (!recordPath) {
    console.error("Usage: pnpm ops:ops-005:evidence:validate <record>");
    process.exit(2);
  }
  const raw = readRequiredFile(path.resolve(recordPath));
  const issues = validateOps005ProductionEvidence(raw, {
    now: process.env.AREAFORGE_OPS005_NOW ? new Date(process.env.AREAFORGE_OPS005_NOW) : undefined,
    maxAgeHours: process.env.AREAFORGE_OPS005_MAX_AGE_HOURS
      ? Number(process.env.AREAFORGE_OPS005_MAX_AGE_HOURS)
      : undefined,
  });
  if (issues.length > 0) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    console.error(`OPS-005 production evidence validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }
  console.log("OPS-005 production evidence validation passed: V2 implementation, signed release, deployment, rejection, lock, reconciliation, freshness, and safety facts are present.");
  console.log(`ops005ProductionEvidenceRecordHash: sha256:${sha256(raw)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
