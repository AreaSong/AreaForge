import path from "node:path";
import {
  buildEvidenceHash,
  parseIndentedKeyValueRecord,
  readRequiredFile,
  requireField,
  requireIsoTimestamp,
  requireNo,
  requireOneOf,
  requireSha256,
  scanForSecrets,
  type ValidationIssue,
} from "./record-validator-common";

const scalarFields = [
  "rollbackProofId", "recordedAt", "rollbackStartedAt", "rollbackFinishedAt", "operator", "environment", "evidenceClass",
  "rollbackSource", "highRiskConfirmation", "sourceVersion", "sourceImage", "targetVersion", "targetImage",
  "sourceUpdateRecordHash", "rollbackOperationRecordHash", "postRollbackUpdateRecordHash", "postRollbackEvidenceBundleHash",
  "postRollbackSmokeRecordHash", "postRollbackHealth", "postRollbackAuthenticatedSmoke", "databaseAccessible", "uploadsAccessible",
  "attachmentAccess", "autoApplyPolicy", "updateAgentBlocker", "historicalRecordsPreserved", "databaseRestoreAttempted",
  "uploadsRestoreAttempted", "rollbackDurationMinutes", "reopenDecision", "reopenConditions", "residualRiskIds", "doesNotProve",
] as const;

const safetyFields = [
  "safetyFacts.secretValuePrinted",
  "safetyFacts.realStudyContentIncluded",
  "safetyFacts.residualLedgerUpdated",
  "safetyFacts.updateChannelReopened",
] as const;

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm rollback:proof:validate <rollback-proof-record.md|txt>");
    process.exit(2);
  }
  const raw = readRequiredFile(path.resolve(recordPath));
  const fields = parseIndentedKeyValueRecord(raw);
  const issues = validateRecord(raw, fields);
  if (issues.length > 0) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    console.error(`rollback proof record validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }
  console.log("rollback proof record validation passed: immutable targets, operation hashes, post-rollback signals, reopen conditions, residuals, and safety boundaries are present.");
  console.log(`rollbackProofEvidenceHash: ${buildEvidenceHash(fields, [...scalarFields, ...safetyFields])}`);
  console.log("claimBoundary: ready-for-human-review does not reopen the update channel, authorize restore, close residuals, or prove future production health.");
}

function validateRecord(raw: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of [...scalarFields, ...safetyFields]) requireField(fields, field, issues);
  for (const field of ["recordedAt", "rollbackStartedAt", "rollbackFinishedAt"] as const) requireIsoTimestamp(fields, field, issues);
  requireOneOf(fields, "environment", ["production", "staging", "local"], issues);
  requireOneOf(fields, "evidenceClass", ["production", "runtime", "local"], issues);
  requireOneOf(fields, "rollbackSource", ["updater", "manual-operator"], issues);
  requireOneOf(fields, "highRiskConfirmation", ["yes"], issues);
  for (const field of ["postRollbackHealth", "postRollbackAuthenticatedSmoke"] as const) requireOneOf(fields, field, ["pass", "fail"], issues);
  for (const field of ["databaseAccessible", "uploadsAccessible"] as const) requireOneOf(fields, field, ["pass", "fail", "not-checked"], issues);
  requireOneOf(fields, "attachmentAccess", ["pass", "fail", "not-applicable", "not-checked"], issues);
  requireOneOf(fields, "autoApplyPolicy", ["none", "patch"], issues);
  requireOneOf(fields, "updateAgentBlocker", ["none", "present", "unknown"], issues);
  requireOneOf(fields, "historicalRecordsPreserved", ["yes", "no"], issues);
  for (const field of ["databaseRestoreAttempted", "uploadsRestoreAttempted"] as const) requireOneOf(fields, field, ["yes", "no"], issues);
  requireOneOf(fields, "reopenDecision", ["keep-closed", "ready-for-human-review"], issues);
  for (const field of safetyFields) {
    requireOneOf(fields, field, ["no"], issues);
    requireNo(fields, field, issues);
  }
  for (const field of ["sourceUpdateRecordHash", "rollbackOperationRecordHash", "postRollbackUpdateRecordHash", "postRollbackEvidenceBundleHash", "postRollbackSmokeRecordHash"] as const) {
    requireSha256(fields, field, issues);
  }
  for (const field of ["sourceVersion", "targetVersion"] as const) {
    if (!/^\d+\.\d+\.\d+$/.test(fields.get(field) ?? "")) issues.push({ field, message: "must look like X.Y.Z" });
  }
  for (const field of ["sourceImage", "targetImage"] as const) {
    if (!/@sha256:[a-f0-9]{64}$/i.test(fields.get(field) ?? "")) issues.push({ field, message: "must use image@sha256:<64 hex>" });
  }
  const duration = Number(fields.get("rollbackDurationMinutes"));
  if (!Number.isInteger(duration) || duration <= 0) issues.push({ field: "rollbackDurationMinutes", message: "must be a positive integer" });
  if (Date.parse(fields.get("rollbackFinishedAt") ?? "") < Date.parse(fields.get("rollbackStartedAt") ?? "")) {
    issues.push({ field: "rollbackFinishedAt", message: "must not be earlier than rollbackStartedAt" });
  }

  validateResiduals(fields, issues);
  validateClaimBoundary(fields, issues);
  validateReadyForHumanReview(fields, issues);
  scanForSecrets(raw, issues);
  return issues;
}

function validateResiduals(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const value = fields.get("residualRiskIds")?.trim() ?? "";
  if (!value) {
    issues.push({ field: "residualRiskIds", message: "must be none or an AF-RISK-* list" });
    return;
  }
  if (value.toLowerCase() !== "none" && !value.split(",").every((item) => /^AF-RISK-[A-Z]+-\d{3}$/.test(item.trim()))) {
    issues.push({ field: "residualRiskIds", message: "must use comma-separated AF-RISK-* IDs" });
  }
}

function validateClaimBoundary(fields: Map<string, string>, issues: ValidationIssue[]): void {
  const reopenConditions = fields.get("reopenConditions")?.trim() ?? "";
  if (reopenConditions.length < 24) issues.push({ field: "reopenConditions", message: "must state concrete future update-channel reopen conditions" });
  const boundary = fields.get("doesNotProve")?.toLowerCase() ?? "";
  for (const term of ["future production health", "production restore readiness", "residual risk closure", "automatic update-channel reopen"]) {
    if (!boundary.includes(term)) issues.push({ field: "doesNotProve", message: `must mention ${term}` });
  }
}

function validateReadyForHumanReview(fields: Map<string, string>, issues: ValidationIssue[]): void {
  if (fields.get("environment") === "production" && fields.get("evidenceClass") !== "production") {
    issues.push({ field: "evidenceClass", message: "must be production for a production rollback proof" });
  }
  if (fields.get("reopenDecision") !== "ready-for-human-review") return;
  for (const field of ["postRollbackHealth", "postRollbackAuthenticatedSmoke", "databaseAccessible", "uploadsAccessible"] as const) {
    if (fields.get(field) !== "pass") issues.push({ field, message: "must be pass before ready-for-human-review" });
  }
  if (!new Set(["pass", "not-applicable"]).has(fields.get("attachmentAccess") ?? "")) {
    issues.push({ field: "attachmentAccess", message: "must be pass or not-applicable before ready-for-human-review" });
  }
  if (fields.get("autoApplyPolicy") !== "none") issues.push({ field: "autoApplyPolicy", message: "must remain none before ready-for-human-review" });
  if (fields.get("updateAgentBlocker") !== "none") issues.push({ field: "updateAgentBlocker", message: "must be none before ready-for-human-review" });
  if (fields.get("historicalRecordsPreserved") !== "yes") issues.push({ field: "historicalRecordsPreserved", message: "must be yes before ready-for-human-review" });
}

main();
