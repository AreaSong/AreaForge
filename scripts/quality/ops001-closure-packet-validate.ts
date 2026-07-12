import { readFileSync } from "node:fs";
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
  "packetId",
  "generatedAt",
  "residualRiskId",
  "environment",
  "baseUrl",
  "expectedVersion",
  "releaseTag",
  "smokeRecordHash",
  "smokeValidation",
  "smokeCheckedAt",
  "smokeStatus",
  "smokePasswordReadFromFile",
  "smokeUpdateStatusIncluded",
  "updateAgentStatusRecordHash",
  "updateAgentValidation",
  "updateAgentCurrentVersion",
  "updateAgentAutoApply",
  "updateAgentSignatureRequired",
  "updateAgentBlocker",
  "updateAgentRollbackAvailable",
  "operationalEvidenceBundleHash",
  "operationalEvidenceBundleValidation",
  "operationalEvidenceBundleStatus",
  "authenticatedSmokeSignalStatus",
  "updateAgentSignalStatus",
  "updaterEnvSummary",
  "updateRecordSummary",
  "closeConditionEvidence",
  "residualLedgerAction",
  "followUpTasks",
] as const;

const requiredNestedFields = [
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.backupRestoreAttempted",
  "safetyFacts.migrationAttempted",
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.secretValuePrinted",
  "safetyFacts.updaterApplyAttempted",
  "safetyFacts.residualLedgerUpdated",
] as const;

function main(): void {
  const packetPath = process.argv[2];
  if (!packetPath) {
    console.error("Usage: pnpm ops:ops-001:closure:validate <ops-001-closure-packet.md|txt>");
    process.exit(2);
  }

  const raw = readRequiredFile(path.resolve(packetPath));
  const issues = validateOps001ClosurePacket(raw);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`OPS-001 closure packet validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  const fields = parseIndentedKeyValueRecord(raw);
  console.log("OPS-001 closure packet validation passed: smoke, update-agent, evidence bundle, safety facts, and residual boundary are present.");
  console.log(`ops001ClosurePacketEvidenceHash: ${buildEvidenceHash(fields, [...requiredScalarFields, ...requiredNestedFields])}`);
  console.log("safetyFacts: serverCommandAttempted=false backupRestoreAttempted=false migrationAttempted=false productionWriteAttempted=false secretValuePrinted=false updaterApplyAttempted=false residualLedgerUpdated=false");
}

export function validateOps001ClosurePacket(raw: string): ValidationIssue[] {
  const fields = parseIndentedKeyValueRecord(raw);
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }

  requireIsoTimestamp(fields, "generatedAt", issues);
  requireIsoTimestamp(fields, "smokeCheckedAt", issues);
  requireOneOf(fields, "environment", ["production"], issues);
  requireOneOf(fields, "smokeValidation", ["pass"], issues);
  requireOneOf(fields, "smokeStatus", ["pass"], issues);
  requireOneOf(fields, "smokePasswordReadFromFile", ["yes"], issues);
  requireOneOf(fields, "smokeUpdateStatusIncluded", ["yes"], issues);
  requireOneOf(fields, "updateAgentValidation", ["pass"], issues);
  requireOneOf(fields, "updateAgentAutoApply", ["none"], issues);
  requireOneOf(fields, "updateAgentSignatureRequired", ["true"], issues);
  requireOneOf(fields, "updateAgentBlocker", ["null"], issues);
  requireOneOf(fields, "updateAgentRollbackAvailable", ["true", "false"], issues);
  requireOneOf(fields, "operationalEvidenceBundleValidation", ["pass"], issues);
  requireOneOf(fields, "operationalEvidenceBundleStatus", ["ready", "needs_attention"], issues);
  requireOneOf(fields, "authenticatedSmokeSignalStatus", ["ready"], issues);
  requireOneOf(fields, "updateAgentSignalStatus", ["ready"], issues);
  requireOneOf(fields, "residualLedgerAction", ["ready-for-human-close-after-review"], issues);

  requireSha256(fields, "smokeRecordHash", issues);
  requireSha256(fields, "updateAgentStatusRecordHash", issues);
  requireSha256(fields, "operationalEvidenceBundleHash", issues);

  if (fields.get("residualRiskId") !== "AF-RISK-OPS-001") {
    issues.push({ field: "residualRiskId", message: "must be AF-RISK-OPS-001" });
  }

  const baseUrl = fields.get("baseUrl");
  if (baseUrl && !/^https:\/\/[^ \n]+$/i.test(baseUrl)) {
    issues.push({ field: "baseUrl", message: "must be an https URL" });
  }

  const expectedVersion = fields.get("expectedVersion");
  if (expectedVersion && !/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
    issues.push({ field: "expectedVersion", message: "must look like X.Y.Z" });
  }

  const releaseTag = fields.get("releaseTag");
  if (releaseTag && !/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
    issues.push({ field: "releaseTag", message: "must look like vX.Y.Z" });
  }

  const updateAgentCurrentVersion = fields.get("updateAgentCurrentVersion");
  if (updateAgentCurrentVersion && !/^\d+\.\d+\.\d+$/.test(updateAgentCurrentVersion)) {
    issues.push({ field: "updateAgentCurrentVersion", message: "must look like X.Y.Z" });
  }

  const currentExpectedVersion = expectedOps001Version();
  if (expectedVersion && expectedVersion !== currentExpectedVersion) {
    issues.push({
      field: "expectedVersion",
      message: `must match current expected OPS-001 version ${currentExpectedVersion}; set AREAFORGE_OPS001_EXPECTED_VERSION only for historical evidence validation`,
    });
  }
  if (releaseTag && releaseTag !== `v${currentExpectedVersion}`) {
    issues.push({ field: "releaseTag", message: `must be v${currentExpectedVersion}` });
  }
  if (updateAgentCurrentVersion && updateAgentCurrentVersion !== currentExpectedVersion) {
    issues.push({ field: "updateAgentCurrentVersion", message: `must be ${currentExpectedVersion}` });
  }

  const updaterEnvSummary = fields.get("updaterEnvSummary") ?? "";
  if (!/AREAFORGE_EXTRA_SMOKE_COMMAND/i.test(updaterEnvSummary) || /not supplied|none|unknown/i.test(updaterEnvSummary)) {
    issues.push({ field: "updaterEnvSummary", message: "must prove AREAFORGE_EXTRA_SMOKE_COMMAND is configured without exposing secrets" });
  }

  const updateRecordSummary = fields.get("updateRecordSummary") ?? "";
  if (!/sha256:[a-f0-9]{64}/i.test(updateRecordSummary)) {
    issues.push({ field: "updateRecordSummary", message: "must include a redacted update-record sha256 summary" });
  }

  const closeConditionEvidence = fields.get("closeConditionEvidence") ?? "";
  for (const term of ["server extra smoke", "password file", "smoke passed", "update-agent status validated", "evidence bundle"]) {
    if (!closeConditionEvidence.toLowerCase().includes(term)) {
      issues.push({ field: "closeConditionEvidence", message: `must mention ${term}` });
    }
  }

  for (const field of requiredNestedFields) {
    requireNo(fields, field, issues);
  }

  scanForSecrets(raw, issues);
  return issues;
}

function expectedOps001Version(): string {
  const envVersion = process.env.AREAFORGE_OPS001_EXPECTED_VERSION?.trim();
  if (envVersion) return envVersion;
  try {
    const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as { version?: unknown };
    if (typeof packageJson.version === "string" && packageJson.version.trim()) {
      return packageJson.version.trim();
    }
  } catch {
    // Fall through to the current repository baseline.
  }
  return "0.1.7";
}

main();
