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

const requiredScalarFields = [
  "windowId",
  "startedAt",
  "finishedAt",
  "operator",
  "cadence",
  "environment",
  "commandsRun",
  "readinessOverall",
  "evidenceBundleStatus",
  "alertPreviewStatus",
  "healthStatus",
  "updateAgentStatus",
  "authenticatedSmokeStatus",
  "backupStatus",
  "infrastructureStatus",
  "readinessSummaryHash",
  "evidenceBundleHash",
  "alertPreviewHash",
  "residualReviewHash",
  "residualReviewStatus",
  "dueResidualRiskIds",
  "decisions",
  "followUpTasks",
  "result",
  "residualRiskIds",
] as const;

const requiredNestedFields = [
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.backupRestoreAttempted",
  "safetyFacts.migrationAttempted",
  "safetyFacts.updaterApplyAttempted",
  "safetyFacts.rollbackAttempted",
  "safetyFacts.secretValuePrinted",
] as const;

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm maintenance:window:validate <maintenance-window-record.md|txt>");
    process.exit(2);
  }

  const record = readRequiredFile(path.resolve(recordPath));
  const fields = parseIndentedKeyValueRecord(record);
  const issues = validateRecord(record, fields);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`maintenance window record validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("maintenance window record validation passed: cadence commands, residual review, evidence hashes, result, and safety facts are present.");
  console.log(`maintenanceWindowRecordEvidenceHash: ${buildEvidenceHash(fields, [...requiredScalarFields, ...requiredNestedFields])}`);
  console.log("safetyFacts: productionWriteAttempted=false serverCommandAttempted=false backupRestoreAttempted=false migrationAttempted=false updaterApplyAttempted=false rollbackAttempted=false secretValuePrinted=false");
}

function validateRecord(record: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }

  requireIsoTimestamp(fields, "startedAt", issues);
  requireIsoTimestamp(fields, "finishedAt", issues);
  requireOneOf(fields, "cadence", ["daily", "weekly", "monthly", "release", "incident"], issues);
  requireOneOf(fields, "environment", ["production", "staging", "local", "ci"], issues);
  requireOneOf(fields, "readinessOverall", ["pass", "warn", "fail", "blocked", "unknown", "not-applicable"], issues);
  requireOneOf(fields, "evidenceBundleStatus", ["ready", "needs_attention", "blocked", "not-applicable"], issues);
  requireOneOf(fields, "alertPreviewStatus", ["ok", "watch", "warning", "critical", "not-applicable"], issues);
  for (const field of ["healthStatus", "updateAgentStatus", "authenticatedSmokeStatus", "backupStatus", "infrastructureStatus"] as const) {
    requireOneOf(fields, field, ["pass", "warn", "fail", "blocked", "unknown", "not-applicable"], issues);
  }
  requireOneOf(fields, "residualReviewStatus", ["pass", "warn", "fail"], issues);
  requireOneOf(fields, "result", ["pass", "warn", "fail", "blocked"], issues);
  for (const field of requiredNestedFields) {
    requireOneOf(fields, field, ["yes", "no"], issues);
    requireNo(fields, field, issues);
  }

  for (const field of ["readinessSummaryHash", "evidenceBundleHash", "alertPreviewHash", "residualReviewHash"] as const) {
    const value = fields.get(field)?.toLowerCase();
    if (value && value !== "not-applicable") {
      requireSha256(fields, field, issues);
    }
  }

  const commands = fields.get("commandsRun") ?? "";
  for (const command of ["pnpm maintenance:cadence:preflight", "pnpm residuals:review-due"]) {
    if (!commands.includes(command)) {
      issues.push({ field: "commandsRun", message: `must include ${command}` });
    }
  }

  const result = fields.get("result")?.toLowerCase();
  if (result === "pass" && fields.get("residualReviewStatus")?.toLowerCase() === "fail") {
    issues.push({ field: "result", message: "cannot be pass when residualReviewStatus is fail" });
  }

  const dueIds = fields.get("dueResidualRiskIds")?.trim().toLowerCase() ?? "";
  if (dueIds === "") {
    issues.push({ field: "dueResidualRiskIds", message: "must be none or a comma-separated AF-RISK list" });
  }
  if (dueIds !== "none" && !/AF-RISK-/i.test(dueIds)) {
    issues.push({ field: "dueResidualRiskIds", message: "must use AF-RISK-* IDs when not none" });
  }

  scanForSecrets(record, issues);
  return issues;
}

main();
