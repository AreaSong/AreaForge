import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  commonSecretPatterns,
  parseIndentedKeyValueRecord,
  requireField,
  requireNo,
  requireSha256,
  scanForSecrets,
  sha256,
  type ValidationIssue,
} from "./record-validator-common";

type JsonRecord = Record<string, unknown>;

const exportDirArg = process.argv[2];

const requiredFiles = [
  "release-update-safe-fields.txt",
  "redacted-update-status.json",
  "prod-readonly-smoke-output.log",
  "remote-summary.txt",
] as const;

const redactedExportSecretPatterns = [
  ...commonSecretPatterns,
  {
    label: "generic secret assignment",
    pattern: /\b(?![A-Z0-9_]*PASSWORD_FILE\b)[A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|PRIVATE_KEY|API_KEY)[A-Z0-9_]*\s*=\s*\S+/i,
  },
  { label: "JSON cookie or token key", pattern: /"(?:cookie|session|token|password|secret|apiKey|api_key)"\s*:/i },
];

const allowedSmokeTopLevelKeys = new Set(["ok", "baseUrl", "checkedAt", "command", "checks"]);
const allowedSmokeCheckKeys = new Set(["name", "ok", "durationMs"]);
const redactedPathFields = [
  "databaseBackupPath",
  "uploadsBackupPath",
  "envBackupPath",
  "composeConfigBackupPath",
  "nginxConfigBackupPath",
  "extraSmokeLogPath",
] as const;

const allowedUpdateFields = new Set([
  "releaseId",
  "updatedAt",
  "status",
  "githubRepo",
  "releaseTag",
  "targetVersion",
  "targetChannel",
  "gitCommit",
  "previousAppVersion",
  "previousImage",
  "targetWebImage",
  "targetWebImageDigest",
  "migrationApplied",
  "migrationImageDigest",
  "sbomAsset",
  "sbomSha256",
  "provenanceAsset",
  "provenanceSha256",
  "composeUpdated",
  "databaseBackupPath",
  "databaseBackupSha256",
  "uploadsBackupPath",
  "uploadsBackupSha256",
  "envBackupPath",
  "envBackupSha256",
  "composeConfigBackupPath",
  "composeHash",
  "nginxConfigBackupPath",
  "healthUrl",
  "smokeHealth",
  "extraSmoke",
  "extraSmokeLogPath",
  "rollbackAttempted",
  "databaseRestoreAttempted",
  "uploadsRestoreAttempted",
  "failureReason",
  "releaseNotesUrl",
]);

const requiredUpdateFields = [
  "releaseId",
  "updatedAt",
  "status",
  "githubRepo",
  "releaseTag",
  "targetVersion",
  "gitCommit",
  "previousAppVersion",
  "previousImage",
  "targetWebImage",
  "targetWebImageDigest",
  "migrationApplied",
  "migrationImageDigest",
  "databaseBackupPath",
  "databaseBackupSha256",
  "uploadsBackupPath",
  "uploadsBackupSha256",
  "envBackupPath",
  "envBackupSha256",
  "composeConfigBackupPath",
  "composeHash",
  "nginxConfigBackupPath",
  "smokeHealth",
  "extraSmoke",
  "rollbackAttempted",
  "databaseRestoreAttempted",
  "uploadsRestoreAttempted",
  "failureReason",
] as const;

function main(): void {
  if (!exportDirArg) {
    console.error("Usage: pnpm release:evidence:redacted-export:validate <redacted-export-dir>");
    process.exit(2);
  }

  const exportDir = path.resolve(exportDirArg);
  const issues = validateDirectory(exportDir);
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`release evidence redacted export validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  const safeFieldsPath = path.join(exportDir, "release-update-safe-fields.txt");
  const summaryPath = path.join(exportDir, "remote-summary.txt");
  const safeFields = parseIndentedKeyValueRecord(readFileSync(safeFieldsPath, "utf8"));
  const summary = parseIndentedKeyValueRecord(readFileSync(summaryPath, "utf8"));
  const releaseEvidenceRedactedExportHash = buildExportHash(exportDir);

  console.log("release evidence redacted export validation passed: files are present, backup hashes are valid, status is redacted, smoke output is bounded and post-update, and no secret-like content was found.");
  console.log(`releaseEvidenceRedactedExportHash: sha256:${releaseEvidenceRedactedExportHash}`);
  console.log(`updateRecordSummary: update-record hash ${summary.get("updateRecordSha256") ?? "missing"}`);
  console.log("releaseRecordFields:");
  for (const field of [
    "databaseBackupSha256",
    "uploadsBackupSha256",
    "envBackupSha256",
    "composeHash",
  ]) {
    console.log(`  ${field}: ${safeFields.get(field) ?? ""}`);
  }
  console.log("redactedPathEvidence:");
  for (const field of [
    "databaseBackupPath",
    "uploadsBackupPath",
    "envBackupPath",
    "composeConfigBackupPath",
    "nginxConfigBackupPath",
  ]) {
    console.log(`  ${field}: ${safeFields.has(field) ? "<redacted-root-only-path-present>" : "missing"}`);
  }
  console.log("safetyFacts: readOnlyExport=true serverCommandAttempted=false productionWriteAttempted=false secretValuePrinted=false smokePasswordFileReadAttempted=false residualLedgerUpdated=false");
}

function validateDirectory(exportDir: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!existsSync(exportDir)) {
    return [{ field: "exportDir", message: "directory does not exist" }];
  }
  if (!lstatSync(exportDir).isDirectory()) {
    return [{ field: "exportDir", message: "must be a directory" }];
  }

  for (const fileName of requiredFiles) {
    const filePath = path.join(exportDir, fileName);
    if (!existsSync(filePath)) {
      issues.push({ field: fileName, message: "is required" });
    } else if (!lstatSync(filePath).isFile()) {
      issues.push({ field: fileName, message: "must be a regular file" });
    }
  }
  if (issues.length > 0) return issues;

  const safeFieldsRaw = readFileSync(path.join(exportDir, "release-update-safe-fields.txt"), "utf8");
  const updateStatusRaw = readFileSync(path.join(exportDir, "redacted-update-status.json"), "utf8");
  const smokeOutputRaw = readFileSync(path.join(exportDir, "prod-readonly-smoke-output.log"), "utf8");
  const summaryRaw = readFileSync(path.join(exportDir, "remote-summary.txt"), "utf8");
  const safeFields = parseIndentedKeyValueRecord(safeFieldsRaw);

  scanForSecrets(`${safeFieldsRaw}\n${updateStatusRaw}\n${smokeOutputRaw}\n${summaryRaw}`, issues, redactedExportSecretPatterns);
  issues.push(...validateSafeFields(safeFieldsRaw));
  issues.push(...validateSummary(summaryRaw, exportDir));
  issues.push(...validateSmokeOutput(smokeOutputRaw, safeFields));
  issues.push(...validateRedactedStatus(path.join(exportDir, "redacted-update-status.json")));

  return issues;
}

function validateSafeFields(raw: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!match) {
      issues.push({ field: `release-update-safe-fields.txt:${index + 1}`, message: "must be key: value" });
      continue;
    }
    const key = match[1] ?? "";
    if (!allowedUpdateFields.has(key)) {
      issues.push({ field: key, message: "is not an allowlisted update-record field" });
    }
  }

  const fields = parseIndentedKeyValueRecord(raw);
  for (const field of requiredUpdateFields) {
    requireField(fields, field, issues);
  }
  if (Number.isNaN(Date.parse(fields.get("updatedAt") ?? ""))) {
    issues.push({ field: "updatedAt", message: "must be ISO-8601" });
  }
  for (const field of redactedPathFields) {
    const value = fields.get(field);
    if (value && value !== "<redacted-root-only-path>") {
      issues.push({ field, message: "must be redacted as <redacted-root-only-path>" });
    }
  }

  for (const field of ["databaseBackupSha256", "uploadsBackupSha256", "envBackupSha256", "composeHash", "sbomSha256", "provenanceSha256"]) {
    requireSha256(fields, field, issues);
  }
  if (fields.get("status") !== "success") {
    issues.push({ field: "status", message: "must be success for release evidence completion" });
  }
  if (fields.get("smokeHealth") !== "PASS") {
    issues.push({ field: "smokeHealth", message: "must be PASS" });
  }
  if (fields.get("extraSmoke") !== "PASS") {
    issues.push({ field: "extraSmoke", message: "must be PASS" });
  }
  for (const field of ["rollbackAttempted", "databaseRestoreAttempted", "uploadsRestoreAttempted"]) {
    requireNo(fields, field, issues);
  }
  if (!/^v\d+\.\d+\.\d+$/.test(fields.get("releaseTag") ?? "")) {
    issues.push({ field: "releaseTag", message: "must look like vX.Y.Z" });
  }
  if (!/^\d+\.\d+\.\d+$/.test(fields.get("targetVersion") ?? "")) {
    issues.push({ field: "targetVersion", message: "must look like X.Y.Z" });
  }
  for (const field of ["previousImage", "targetWebImage"]) {
    const value = fields.get(field) ?? "";
    if (!/@sha256:[a-f0-9]{64}$/i.test(value)) {
      issues.push({ field, message: "must use image@sha256 digest" });
    }
  }
  const targetDigest = fields.get("targetWebImageDigest") ?? "";
  if (!/^(sha256:)?[a-f0-9]{64}$/i.test(targetDigest)) {
    issues.push({ field: "targetWebImageDigest", message: "must be sha256:<64 hex> or 64 hex" });
  }

  return issues;
}

function validateSummary(raw: string, exportDir: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fields = parseIndentedKeyValueRecord(raw);
  if (fields.get("mode") !== "release-evidence-redacted-export-no-secret-read") {
    issues.push({ field: "mode", message: "must be release-evidence-redacted-export-no-secret-read" });
  }
  const redactedSourceFields = [
    "outputDir",
    "sourceUpdateRecord",
    "sourceStatus",
    "sourceSmokeLog",
  ];
  for (const field of redactedSourceFields) {
    requireField(fields, field, issues);
    const value = fields.get(field) ?? "";
    if (field !== "sourceSmokeLog" && !value.startsWith("<redacted-")) {
      issues.push({ field, message: "must be a redacted placeholder" });
    }
    if (field === "sourceSmokeLog" && value !== "not-provided-or-not-configured" && !value.startsWith("<redacted-")) {
      issues.push({ field, message: "must be a redacted placeholder or not-provided-or-not-configured" });
    }
  }
  for (const field of [
    "releaseUpdateSafeFields",
    "redactedUpdateStatusRecord",
    "prodReadonlySmokeOutput",
    "updateRecordSha256",
  ]) {
    requireField(fields, field, issues);
  }
  requireSummaryShaMatches(fields, "releaseUpdateSafeFields", path.join(exportDir, "release-update-safe-fields.txt"), issues);
  requireSummaryShaMatches(fields, "redactedUpdateStatusRecord", path.join(exportDir, "redacted-update-status.json"), issues);
  requireSummaryShaMatches(fields, "prodReadonlySmokeOutput", path.join(exportDir, "prod-readonly-smoke-output.log"), issues);
  requireSha256(fields, "updateRecordSha256", issues);
  for (const field of [
    "safetyFacts.updaterApplyAttempted",
    "safetyFacts.backupRestoreAttempted",
    "safetyFacts.migrationAttempted",
    "safetyFacts.rollbackAttempted",
    "safetyFacts.productionWriteAttempted",
    "safetyFacts.secretFileReadAttempted",
    "safetyFacts.secretValuePrinted",
    "safetyFacts.smokePasswordFileReadAttempted",
    "safetyFacts.residualLedgerUpdated",
  ]) {
    if (fields.get(field) !== "no") {
      issues.push({ field, message: "must be no" });
    }
  }
  return issues;
}

function requireSummaryShaMatches(
  fields: Map<string, string>,
  field: string,
  localFilePath: string,
  issues: ValidationIssue[],
): void {
  const value = fields.get(field) ?? "";
  const match = /\bsha256:([a-f0-9]{64})\b/i.exec(value);
  if (!match) {
    issues.push({ field, message: "must include sha256:<64 hex>" });
    return;
  }
  const actual = sha256(readFileSync(localFilePath, "utf8"));
  if ((match[1] ?? "").toLowerCase() !== actual.toLowerCase()) {
    issues.push({ field, message: `sha256 does not match ${path.basename(localFilePath)}` });
  }
}

function validateSmokeOutput(raw: string, safeFields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (raw.includes("prodReadonlySmokeOutput: missing")) {
    return [{ field: "prodReadonlySmokeOutput", message: "must be present for release evidence completion" }];
  }
  const jsonLine = raw
    .split(/\r?\n/)
    .reverse()
    .map((line) => line.trim())
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) {
    return [{ field: "prodReadonlySmokeOutput", message: "must contain final JSON result" }];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonLine);
  } catch (error) {
    return [{ field: "prodReadonlySmokeOutput", message: error instanceof Error ? error.message : "invalid final JSON" }];
  }
  if (!isRecord(parsed)) {
    return [{ field: "prodReadonlySmokeOutput", message: "final JSON must be an object" }];
  }
  for (const key of Object.keys(parsed)) {
    if (!allowedSmokeTopLevelKeys.has(key)) {
      issues.push({ field: `prodReadonlySmokeOutput.${key}`, message: "is not an allowed smoke JSON key" });
    }
  }
  if (parsed.ok !== true) {
    issues.push({ field: "prodReadonlySmokeOutput.ok", message: "must be true" });
  }
  if (typeof parsed.checkedAt !== "string" || Number.isNaN(Date.parse(parsed.checkedAt))) {
    issues.push({ field: "prodReadonlySmokeOutput.checkedAt", message: "must be ISO-8601" });
  } else {
    const updateRecordTime = Date.parse(safeFields.get("updatedAt") ?? "");
    const smokeTime = Date.parse(parsed.checkedAt);
    if (!Number.isNaN(updateRecordTime) && smokeTime < updateRecordTime) {
      issues.push({ field: "prodReadonlySmokeOutput.checkedAt", message: "must not be earlier than update-record updatedAt" });
    }
  }
  const checks = Array.isArray(parsed.checks)
    ? parsed.checks.map((check, index) => {
      if (!isRecord(check)) {
        issues.push({ field: `prodReadonlySmokeOutput.checks.${index}`, message: "must be an object" });
        return "";
      }
      for (const key of Object.keys(check)) {
        if (!allowedSmokeCheckKeys.has(key)) {
          issues.push({ field: `prodReadonlySmokeOutput.checks.${index}.${key}`, message: "is not an allowed check key" });
        }
      }
      return String(check.name ?? "");
    })
    : [];
  if (!Array.isArray(parsed.checks)) {
    issues.push({ field: "prodReadonlySmokeOutput.checks", message: "must be an array" });
  }
  for (const required of ["health", "login", "update-status"]) {
    if (!checks.includes(required)) {
      issues.push({ field: "prodReadonlySmokeOutput.checks", message: `must include ${required}` });
    }
  }
  return issues;
}

function validateRedactedStatus(statusPath: string): ValidationIssue[] {
  const result = spawnSync("pnpm", [
    "exec",
    "tsx",
    "scripts/quality/update-agent-status-validate.ts",
    statusPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status === 0) return [];
  return [{
    field: "redacted-update-status.json",
    message: compactOutput(result.stderr || result.stdout || `validator exited ${String(result.status)}`),
  }];
}

function buildExportHash(exportDir: string): string {
  const body = requiredFiles.map((fileName) => {
    const raw = readFileSync(path.join(exportDir, fileName), "utf8");
    return [fileName, sha256(raw)];
  });
  return sha256(JSON.stringify(body));
}

function compactOutput(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
