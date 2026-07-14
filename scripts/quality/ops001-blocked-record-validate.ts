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
  "recordId",
  "generatedAt",
  "mode",
  "residualRiskId",
  "environment",
  "baseUrl",
  "releaseTag",
  "redactedUpdateStatusRecordHash",
  "extraSmokeCommandConfigured",
  "smokeEmailConfigured",
  "smokePasswordFileConfigured",
  "hostPnpmAvailable",
  "preflightStatus",
  "blockers",
  "doesNotProve",
  "residualLedgerAction",
  "forbiddenActions",
] as const;

const requiredNestedFields = [
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.backupRestoreAttempted",
  "safetyFacts.migrationAttempted",
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.updaterApplyAttempted",
  "safetyFacts.rollbackAttempted",
  "safetyFacts.secretValuePrinted",
  "safetyFacts.residualLedgerUpdated",
] as const;

const requiredDoesNotProve = [
  "authenticated smoke passed",
  "operational evidence bundle ready",
  "OPS-001 closure packet ready",
  "AF-RISK-OPS-001 closure",
  "long-term operability",
];

const requiredForbiddenActions = [
  "updater apply",
  "migration",
  "backup",
  "restore",
  "rollback",
  "production writes",
  "secret export",
  "residual ledger closure",
];

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm ops:ops-001:blocked:validate <ops001-blocked-record.md|txt>");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(recordPath));
  const issues = validateOps001BlockedRecord(raw);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`OPS-001 blocked record validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  const fields = parseIndentedKeyValueRecord(raw);
  console.log("OPS-001 blocked record validation passed: prerequisite blockers, redacted status hash, claim boundary, forbidden actions, and safety facts are present.");
  console.log(`ops001BlockedRecordEvidenceHash: ${buildEvidenceHash(fields, [...requiredScalarFields, ...requiredNestedFields])}`);
  console.log("safetyFacts: serverCommandAttempted=recorded backupRestoreAttempted=false migrationAttempted=false productionWriteAttempted=false updaterApplyAttempted=false rollbackAttempted=false secretValuePrinted=false residualLedgerUpdated=false");
}

export function validateOps001BlockedRecord(raw: string): ValidationIssue[] {
  const fields = parseIndentedKeyValueRecord(raw);
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }

  requireIsoTimestamp(fields, "generatedAt", issues);
  requireOneOf(fields, "mode", ["ops001-readonly-evidence-blocked"], issues);
  requireOneOf(fields, "environment", ["production"], issues);
  requireOneOf(fields, "extraSmokeCommandConfigured", ["yes", "no"], issues);
  requireOneOf(fields, "smokeEmailConfigured", ["yes", "no"], issues);
  requireOneOf(fields, "smokePasswordFileConfigured", ["yes", "no"], issues);
  requireOneOf(fields, "hostPnpmAvailable", ["yes", "no"], issues);
  requireOneOf(fields, "preflightStatus", ["blocked_on_prerequisite", "needs_evidence"], issues);
  requireOneOf(fields, "residualLedgerAction", ["remains-open"], issues);
  requireSha256(fields, "redactedUpdateStatusRecordHash", issues);

  if (fields.get("residualRiskId") !== "AF-RISK-OPS-001") {
    issues.push({ field: "residualRiskId", message: "must be AF-RISK-OPS-001" });
  }

  const baseUrl = fields.get("baseUrl");
  if (baseUrl && !/^https:\/\/[^ \n]+$/i.test(baseUrl)) {
    issues.push({ field: "baseUrl", message: "must be an https URL" });
  }

  const releaseTag = fields.get("releaseTag");
  if (releaseTag && !/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
    issues.push({ field: "releaseTag", message: "must look like vX.Y.Z" });
  }

  const blockers = fields.get("blockers")?.toLowerCase() ?? "";
  if (!/(pnpm|smoke|credential|password|email|extra smoke)/.test(blockers)) {
    issues.push({ field: "blockers", message: "must identify a concrete OPS-001 prerequisite blocker" });
  }

  const doesNotProve = fields.get("doesNotProve") ?? "";
  for (const term of requiredDoesNotProve) {
    if (!doesNotProve.includes(term)) {
      issues.push({ field: "doesNotProve", message: `must include ${term}` });
    }
  }

  const forbiddenActions = fields.get("forbiddenActions") ?? "";
  for (const term of requiredForbiddenActions) {
    if (!forbiddenActions.includes(term)) {
      issues.push({ field: "forbiddenActions", message: `must include ${term}` });
    }
  }

  requireOneOf(fields, "safetyFacts.serverCommandAttempted", ["yes", "no"], issues);
  for (const field of requiredNestedFields.filter((field) => field !== "safetyFacts.serverCommandAttempted")) {
    requireNo(fields, field, issues);
  }

  scanForSecrets(raw, issues);
  return issues;
}

main();
