import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  parseIndentedKeyValueRecord,
  scanForSecrets,
  sha256,
  type ValidationIssue,
} from "../quality/record-validator-common";
import { buildReleaseEvidenceBundleHash } from "../quality/release-evidence-validate";
import { validateAttachmentReconciliationSummary } from "../quality/attachment-reconciliation-summary";

const exportDirArg = process.argv[2];
const releaseRecordArg = process.argv[3];
const outputRecordArg = process.argv[4];
const reconciliationCsvArg = process.argv[5];
const reconciliationSummaryArg = process.argv[6];

const safeFieldFile = "release-update-safe-fields.txt";
const summaryFile = "remote-summary.txt";
const statusFile = "redacted-update-status.json";
const smokeFile = "prod-readonly-smoke-output.log";

const copiedFields = [
  "databaseBackupPath",
  "databaseBackupSha256",
  "uploadsBackupPath",
  "uploadsBackupSha256",
  "envBackupPath",
  "envBackupSha256",
  "composeConfigBackupPath",
  "composeHash",
  "nginxConfigBackupPath",
  "previousAppVersion",
  "previousImage",
] as const;

const redactedPathFields = new Set([
  "databaseBackupPath",
  "uploadsBackupPath",
  "envBackupPath",
  "composeConfigBackupPath",
  "nginxConfigBackupPath",
]);

function main(): void {
  if (!exportDirArg || !releaseRecordArg || !outputRecordArg || !reconciliationCsvArg || !reconciliationSummaryArg) {
    console.error("Usage: pnpm release:evidence:redacted-export:record <redacted-export-dir> <release-record> <output-record> <attachment-reconciliation.csv> <attachment-reconciliation-summary.json>");
    process.exit(2);
  }

  const exportDir = path.resolve(exportDirArg);
  const releaseRecordPath = path.resolve(releaseRecordArg);
  const outputRecordPath = path.resolve(outputRecordArg);
  const reconciliationCsvPath = path.resolve(reconciliationCsvArg);
  const reconciliationSummaryPath = path.resolve(reconciliationSummaryArg);
  if (releaseRecordPath === outputRecordPath) {
    console.error("FAIL output-record must be different from release-record; generate a draft first, then review it.");
    process.exit(2);
  }
  if (!existsSync(releaseRecordPath)) {
    console.error(`FAIL release record not found: ${releaseRecordPath}`);
    process.exit(2);
  }
  if (!existsSync(reconciliationCsvPath) || !existsSync(reconciliationSummaryPath)) {
    console.error("FAIL attachment reconciliation CSV and summary are required; the redacted update export does not prove attachment state by itself.");
    process.exit(2);
  }

  validateRedactedExport(exportDir);

  const original = readFileSync(releaseRecordPath, "utf8");
  const originalFields = parseIndentedKeyValueRecord(original);
  const safeFieldsRaw = readFileSync(path.join(exportDir, safeFieldFile), "utf8");
  const summaryRaw = readFileSync(path.join(exportDir, summaryFile), "utf8");
  const statusRaw = readFileSync(path.join(exportDir, statusFile), "utf8");
  const smokeRaw = readFileSync(path.join(exportDir, smokeFile), "utf8");
  const reconciliationCsvRaw = readFileSync(reconciliationCsvPath, "utf8");
  const reconciliationSummaryRaw = readFileSync(reconciliationSummaryPath, "utf8");
  const safeFields = parseIndentedKeyValueRecord(safeFieldsRaw);
  const summary = parseIndentedKeyValueRecord(summaryRaw);
  const issues = validateInputs(originalFields, safeFields, summary);
  issues.push(...validateAttachmentReconciliationSummary(reconciliationSummaryRaw, reconciliationCsvRaw)
    .map((message) => ({ field: "attachmentReconciliationSummary", message })));
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    process.exit(1);
  }

  let next = original;
  for (const field of copiedFields) {
    const value = safeFields.get(field) ?? "";
    next = upsertTopLevelField(next, field, redactedPathFields.has(field) ? "<redacted-root-only-path>" : value);
  }

  const releaseTag = required(safeFields, "releaseTag");
  const targetVersion = required(safeFields, "targetVersion");
  const targetWebImage = required(safeFields, "targetWebImage");
  const migrationImageDigest = required(safeFields, "migrationImageDigest");
  next = upsertTopLevelField(next, "releaseEvidenceRedactedRecordMode", "repo-visible-draft-from-validated-redacted-export");
  next = upsertTopLevelField(next, "releaseEvidenceRedactedRecordCheckedAt", new Date().toISOString());
  next = upsertTopLevelField(next, "releaseEvidenceRedactedRecordDoesNotProve", "production smoke completion, backup/restore execution, migration execution, updater apply execution, residual risk closure, secret disclosure absence beyond validator scan");
  next = upsertTopLevelField(next, "releaseEvidenceRedactedRecordClosesResidual", "no");
  next = upsertTopLevelField(next, "releaseEvidenceRedactedRecordResidualLedgerUpdated", "no");
  next = upsertTopLevelField(next, "releaseEvidenceRedactedRecordSafetyFacts", "serverCommandAttempted=false, productionWriteAttempted=false, secretValuePrinted=false, residualLedgerUpdated=false, originalReleaseRecordOverwritten=false");
  next = upsertTopLevelField(next, "releaseTag", releaseTag);
  next = upsertTopLevelField(next, "AREAFORGE_IMAGE", `ghcr.io/areasong/areaforge-web:${releaseTag}`);
  next = upsertTopLevelField(next, "imageDigest", targetWebImage);
  next = upsertTopLevelField(next, "webImageDigest", targetWebImage);
  next = upsertTopLevelField(next, "migrationImageDigest", `ghcr.io/areasong/areaforge-migration:${releaseTag}@${migrationImageDigest}`);
  next = upsertTopLevelField(next, "migrationApplied", booleanishToYesNo(required(safeFields, "migrationApplied")));
  next = upsertTopLevelField(next, "releaseEvidenceRedactedExportHash", `sha256:${buildExportHash(exportDir)}`);
  next = upsertTopLevelField(next, "releaseEvidenceRedactedUpdateRecordHash", required(summary, "updateRecordSha256"));
  next = upsertTopLevelField(next, "updateAgentStatus", updateAgentStatusSummary(safeFields, summary, statusRaw));
  next = upsertTopLevelField(next, "extraSmokeChecks", smokeCheckSummary(smokeRaw));
  const reconciliationSummary = parseJsonRecord(reconciliationSummaryRaw);
  next = upsertTopLevelField(next, "attachmentReconciliationCsvPath", path.basename(reconciliationCsvPath));
  next = upsertTopLevelField(next, "attachmentReconciliationCsvSha256", `sha256:${sha256(reconciliationCsvRaw)}`);
  next = upsertTopLevelField(next, "attachmentReconciliationSummaryPath", path.basename(reconciliationSummaryPath));
  next = upsertTopLevelField(next, "attachmentReconciliationSummaryHash", stringValue(reconciliationSummary.summaryHash, "missing"));
  next = upsertTopLevelField(next, "attachmentReconciliationStatus", stringValue(reconciliationSummary.status, "missing"));
  next = upsertTopLevelField(next, "residualRisk", updatedResidualRisk(originalFields.get("residualRisk") ?? "", targetVersion));
  next = upsertTopLevelField(next, "releaseEvidenceBundleHash", buildReleaseEvidenceBundleHash(parseIndentedKeyValueRecord(next)));

  const outputIssues: ValidationIssue[] = [];
  scanForSecrets(next, outputIssues);
  if (outputIssues.length > 0) {
    for (const issue of outputIssues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    process.exit(1);
  }

  mkdirSync(path.dirname(outputRecordPath), { recursive: true });
  writeFileSync(outputRecordPath, next.endsWith("\n") ? next : `${next}\n`);

  const validation = spawnSync("pnpm", [
    "exec",
    "tsx",
    "scripts/quality/release-evidence-validate.ts",
    outputRecordPath,
    reconciliationCsvPath,
    reconciliationSummaryPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (validation.status !== 0) {
    console.error(validation.stdout.trim());
    console.error(validation.stderr.trim());
    console.error("FAIL generated release record did not pass release evidence validation.");
    process.exit(1);
  }

  const releaseEvidenceBundleHash = extractReleaseEvidenceBundleHash(validation.stdout);
  console.log("release evidence redacted export record draft generated.");
  console.log(`outputRecord: ${redactPath(outputRecordPath)}`);
  console.log(`releaseTag: ${releaseTag}`);
  console.log(`targetVersion: ${targetVersion}`);
  console.log(`releaseEvidenceRedactedExportHash: sha256:${buildExportHash(exportDir)}`);
  console.log(`generatedReleaseEvidenceBundleHash: ${releaseEvidenceBundleHash ?? "missing"}`);
  console.log("nextCommand: review the draft, then rerun pnpm release:evidence:validate <draft-or-final-record> <attachment-reconciliation.csv> <attachment-reconciliation-summary.json>");
  console.log("safetyFacts: readOnlyExportConsumed=true serverCommandAttempted=false productionWriteAttempted=false secretValuePrinted=false residualLedgerUpdated=false originalReleaseRecordOverwritten=false");
}

function validateRedactedExport(exportDir: string): void {
  const result = spawnSync("pnpm", [
    "exec",
    "tsx",
    "scripts/quality/release-evidence-redacted-export-validate.ts",
    exportDir,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status === 0) return;
  console.error(result.stdout.trim());
  console.error(result.stderr.trim());
  console.error("FAIL redacted export validation failed; release record draft was not generated.");
  process.exit(1);
}

function validateInputs(
  originalFields: Map<string, string>,
  safeFields: Map<string, string>,
  summary: Map<string, string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const originalReleaseTag = originalFields.get("releaseTag");
  const exportReleaseTag = safeFields.get("releaseTag");
  if (originalReleaseTag && exportReleaseTag && originalReleaseTag !== exportReleaseTag) {
    issues.push({ field: "releaseTag", message: `record ${originalReleaseTag} does not match export ${exportReleaseTag}` });
  }
  const originalGitCommit = originalFields.get("gitCommit");
  const exportGitCommit = safeFields.get("gitCommit");
  if (originalGitCommit && exportGitCommit && originalGitCommit !== exportGitCommit) {
    issues.push({ field: "gitCommit", message: "record gitCommit does not match export gitCommit" });
  }
  for (const field of [
    "databaseBackupSha256",
    "uploadsBackupSha256",
    "envBackupSha256",
    "composeHash",
    "previousImage",
    "targetWebImage",
    "migrationImageDigest",
    "updatedAt",
    "releaseTag",
    "targetVersion",
  ]) {
    if (!safeFields.get(field)) issues.push({ field, message: "is required in release-update-safe-fields.txt" });
  }
  if (!summary.get("updateRecordSha256")) {
    issues.push({ field: "updateRecordSha256", message: "is required in remote-summary.txt" });
  }
  return issues;
}

function upsertTopLevelField(record: string, key: string, value: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:.*$`, "m");
  if (pattern.test(record)) {
    return record.replace(pattern, `${key}: ${value}`);
  }
  const insertionPoint = record.search(/^preflight:\s*$/m);
  const line = `${key}: ${value}\n`;
  if (insertionPoint >= 0) {
    return `${record.slice(0, insertionPoint)}${line}${record.slice(insertionPoint)}`;
  }
  return record.endsWith("\n") ? `${record}${line}` : `${record}\n${line}`;
}

function required(fields: Map<string, string>, key: string): string {
  const value = fields.get(key);
  if (!value) throw new Error(`missing required field ${key}`);
  return value;
}

function booleanishToYesNo(value: string): "yes" | "no" {
  return value.toLowerCase() === "true" || value.toLowerCase() === "yes" ? "yes" : "no";
}

function updateAgentStatusSummary(
  safeFields: Map<string, string>,
  summary: Map<string, string>,
  statusRaw: string,
): string {
  const status = parseJsonRecord(statusRaw);
  const autoApply = stringValue(status.autoApply, "unknown");
  const signatureRequired = String(status.signatureRequired ?? "unknown");
  const rollback = isRecord(status.rollback) ? status.rollback : {};
  return [
    "validated redacted export",
    `APP_VERSION=${required(safeFields, "targetVersion")}`,
    `releaseTag=${required(safeFields, "releaseTag")}`,
    `smokeHealth=${required(safeFields, "smokeHealth")}`,
    `extraSmoke=${required(safeFields, "extraSmoke")}`,
    `rollbackAttempted=${required(safeFields, "rollbackAttempted")}`,
    `databaseRestoreAttempted=${required(safeFields, "databaseRestoreAttempted")}`,
    `uploadsRestoreAttempted=${required(safeFields, "uploadsRestoreAttempted")}`,
    `failureReason=${required(safeFields, "failureReason")}`,
    `autoApply=${autoApply}`,
    `signatureRequired=${signatureRequired}`,
    `rollbackTargetVersion=${stringValue(rollback.targetVersion, "unknown")}`,
    `updateRecordSha256=${required(summary, "updateRecordSha256")}`,
    `redactedUpdateStatusSha256=sha256:${sha256(statusRaw)}`,
  ].join("; ");
}

function smokeCheckSummary(smokeRaw: string): string {
  const jsonLine = smokeRaw
    .split(/\r?\n/)
    .reverse()
    .map((line) => line.trim())
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) return "redacted-smoke-json-missing";
  const parsed = parseJsonRecord(jsonLine);
  const checks = Array.isArray(parsed.checks)
    ? parsed.checks
      .filter(isRecord)
      .map((check) => stringValue(check.name, "unknown"))
      .filter((name) => name !== "unknown")
    : [];
  return checks.length > 0 ? checks.join(", ") : "redacted-smoke-checks-empty";
}

function updatedResidualRisk(current: string, targetVersion: string): string {
  const replacement = `Backup SHA256 fields are included from a validated redacted export for ${targetVersion}; root-only backup paths and full update-record remain on the production host.`;
  if (!current) return replacement;
  return current.replace(
    /Backup hashes and full update-record fields are retained on the production host and were not copied into the repo because the current closure scope excludes secret\/backups copying;/,
    `${replacement};`,
  );
}

function extractReleaseEvidenceBundleHash(stdout: string): string | null {
  return /releaseEvidenceBundleHash:\s*(sha256:[a-f0-9]{64})/i.exec(stdout)?.[1] ?? null;
}

function buildExportHash(exportDir: string): string {
  const body = [safeFieldFile, statusFile, smokeFile, summaryFile].map((fileName) => {
    const raw = readFileSync(path.join(exportDir, fileName), "utf8");
    return [fileName, sha256(raw)];
  });
  return sha256(JSON.stringify(body));
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error("expected JSON object");
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function redactPath(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  if (filePath.startsWith("/tmp/")) return "<tmp-output-record>";
  return "<redacted-output-record-path>";
}

main();
