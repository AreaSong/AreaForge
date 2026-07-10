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
  "incidentId",
  "detectedAt",
  "recordedAt",
  "operator",
  "environment",
  "severity",
  "status",
  "incidentType",
  "source",
  "evidenceClass",
  "publicHealthStatus",
  "userImpact",
  "containmentAction",
  "recoveryAction",
  "rollbackDecision",
  "readinessSummaryHash",
  "evidenceBundleHash",
  "alertPreviewHash",
  "highRiskConfirmation",
  "residualRiskIds",
  "followUpTasks",
  "postIncidentReview",
] as const;

const requiredNestedFields = [
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.backupRestoreAttempted",
  "safetyFacts.migrationAttempted",
  "safetyFacts.updaterApplyAttempted",
  "safetyFacts.rollbackAttempted",
  "safetyFacts.secretValuePrinted",
  "safetyFacts.realStudyContentIncluded",
] as const;

const highRiskSafetyFields = [
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.backupRestoreAttempted",
  "safetyFacts.migrationAttempted",
  "safetyFacts.updaterApplyAttempted",
  "safetyFacts.rollbackAttempted",
] as const;

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm incident:record:validate <incident-record.md|txt>");
    process.exit(2);
  }

  const record = readRequiredFile(path.resolve(recordPath));
  const fields = parseIndentedKeyValueRecord(record);
  const issues = validateRecord(record, fields);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`incident record validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("incident record validation passed: required fields, evidence hashes, high-risk confirmation, residual handling, and safety facts are present.");
  console.log(`incidentRecordEvidenceHash: ${buildEvidenceHash(fields, [...requiredScalarFields, ...requiredNestedFields])}`);
  console.log("safetyFacts: secretValuePrinted=false realStudyContentIncluded=false highRiskConfirmation=checked");
}

function validateRecord(record: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }

  for (const field of ["detectedAt", "recordedAt"] as const) {
    requireIsoTimestamp(fields, field, issues);
  }

  requireOneOf(fields, "environment", ["production", "staging", "local", "ci"], issues);
  requireOneOf(fields, "severity", ["p0", "p1", "p2", "p3"], issues);
  requireOneOf(fields, "status", ["open", "mitigated", "resolved", "follow-up"], issues);
  requireOneOf(fields, "incidentType", ["health", "update", "backup", "release", "security", "ai", "upload", "data", "smoke", "other"], issues);
  requireOneOf(fields, "evidenceClass", ["production", "runtime", "release", "local", "docs-only"], issues);
  requireOneOf(fields, "publicHealthStatus", ["pass", "warn", "fail", "unknown", "not-checked"], issues);
  requireOneOf(fields, "rollbackDecision", ["not-needed", "rollback", "roll-forward", "hold", "defer"], issues);
  requireOneOf(fields, "highRiskConfirmation", ["yes", "no", "not-applicable"], issues);
  requireOneOf(fields, "postIncidentReview", ["yes", "no", "not-applicable"], issues);
  for (const field of requiredNestedFields) {
    requireOneOf(fields, field, ["yes", "no"], issues);
  }

  for (const field of ["readinessSummaryHash", "evidenceBundleHash", "alertPreviewHash"] as const) {
    const value = fields.get(field)?.toLowerCase();
    if (value && value !== "not-applicable") {
      requireSha256(fields, field, issues);
    }
  }

  const highRiskAttempted = highRiskSafetyFields.some((field) => fields.get(field)?.toLowerCase() === "yes");
  if (highRiskAttempted && fields.get("highRiskConfirmation")?.toLowerCase() !== "yes") {
    issues.push({ field: "highRiskConfirmation", message: "must be yes when any high-risk production action was attempted" });
  }
  if (!highRiskAttempted && fields.get("highRiskConfirmation")?.toLowerCase() === "yes") {
    issues.push({ field: "highRiskConfirmation", message: "should be not-applicable or no when no high-risk production action was attempted" });
  }

  requireNo(fields, "safetyFacts.secretValuePrinted", issues);
  requireNo(fields, "safetyFacts.realStudyContentIncluded", issues);

  const status = fields.get("status")?.toLowerCase();
  const residuals = fields.get("residualRiskIds")?.toLowerCase() ?? "";
  if (status !== "resolved" && residuals === "none") {
    issues.push({ field: "residualRiskIds", message: "must include a residual ID when incident is not fully resolved" });
  }
  if (status === "resolved" && fields.get("postIncidentReview")?.toLowerCase() !== "yes") {
    issues.push({ field: "postIncidentReview", message: "must be yes when status is resolved" });
  }

  scanForSecrets(record, issues);
  return issues;
}

main();
