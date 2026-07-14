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
  "drillId",
  "drilledAt",
  "operator",
  "environment",
  "scope",
  "sourceBackupVersion",
  "databaseBackupHash",
  "uploadsBackupHash",
  "envConfigBackupHash",
  "restoreTarget",
  "restoreCommandSummary",
  "databaseRestoreResult",
  "uploadsRestoreResult",
  "attachmentHashMatched",
  "appHealthAfterRestore",
  "rollbackDecision",
  "drillEvidenceHash",
  "residualRiskIds",
  "followUpTasks",
] as const;

const requiredNestedFields = [
  "safetyFacts.productionRestoreAttempted",
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.destructiveActionAttempted",
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.secretValuePrinted",
  "safetyFacts.realStudyContentIncluded",
  "safetyFacts.backupDeleted",
  "safetyFacts.uploadDeleted",
] as const;

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm restore:drill:validate <restore-drill-record.md|txt>");
    process.exit(2);
  }

  const record = readRequiredFile(path.resolve(recordPath));
  const fields = parseIndentedKeyValueRecord(record);
  const issues = validateRecord(record, fields);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`restore drill validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("restore drill validation passed: non-production restore evidence, backup hashes, health result, residual handling, and safety facts are present.");
  console.log(`restoreDrillRecordEvidenceHash: ${buildEvidenceHash(fields, [...requiredScalarFields, ...requiredNestedFields])}`);
  console.log("safetyFacts: productionRestoreAttempted=false destructiveActionAttempted=false secretValuePrinted=false backupDeleted=false uploadDeleted=false");
}

function validateRecord(record: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }

  requireIsoTimestamp(fields, "drilledAt", issues);
  requireOneOf(fields, "environment", ["local", "staging", "temporary"], issues);
  requireOneOf(fields, "scope", ["monthly", "release", "pre-migration", "post-incident"], issues);
  requireOneOf(fields, "databaseRestoreResult", ["pass", "fail", "not-applicable"], issues);
  requireOneOf(fields, "uploadsRestoreResult", ["pass", "fail", "not-applicable"], issues);
  requireOneOf(fields, "attachmentHashMatched", ["pass", "fail", "not-applicable"], issues);
  requireOneOf(fields, "appHealthAfterRestore", ["pass", "fail", "not-applicable"], issues);
  requireOneOf(fields, "rollbackDecision", ["not-needed", "repeat-drill", "open-incident", "defer"], issues);
  for (const field of requiredNestedFields) {
    requireOneOf(fields, field, ["yes", "no"], issues);
  }

  for (const field of ["databaseBackupHash", "uploadsBackupHash", "envConfigBackupHash", "drillEvidenceHash"] as const) {
    const value = fields.get(field)?.toLowerCase();
    if (value && value !== "not-applicable") {
      requireSha256(fields, field, issues);
    }
  }

  for (const field of requiredNestedFields) {
    requireNo(fields, field, issues);
  }

  const failed = ["databaseRestoreResult", "uploadsRestoreResult", "attachmentHashMatched", "appHealthAfterRestore"]
    .some((field) => fields.get(field)?.toLowerCase() === "fail");
  if (failed && fields.get("residualRiskIds")?.toLowerCase() === "none") {
    issues.push({ field: "residualRiskIds", message: "must include a residual ID when drill has a failed result" });
  }

  if (fields.get("databaseRestoreResult")?.toLowerCase() !== "pass") {
    issues.push({ field: "databaseRestoreResult", message: "must be pass for a successful restore drill record" });
  }
  if (fields.get("appHealthAfterRestore")?.toLowerCase() !== "pass") {
    issues.push({ field: "appHealthAfterRestore", message: "must be pass for a successful restore drill record" });
  }

  scanForSecrets(record, issues);
  return issues;
}

main();
