import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseAttachmentReconciliationCsv,
  validateAttachmentReconciliationSummary,
} from "./attachment-reconciliation-summary";
import { parseStrictIndentedKeyValueRecord } from "./record-validator-common";

export interface ReleaseEvidenceValidationIssue {
  field: string;
  message: string;
}

export const releaseEvidenceRedactedRecordContract = {
  mode: "repo-visible-draft-from-validated-redacted-export",
  doesNotProve: "production smoke completion, backup/restore execution, migration execution, updater apply execution, residual risk closure, secret disclosure absence beyond validator scan",
  safetyFacts: "serverCommandAttempted=false, productionWriteAttempted=false, secretValuePrinted=false, residualLedgerUpdated=false, originalReleaseRecordOverwritten=false",
} as const;

const redactedRecordMetadataFields = [
  "releaseEvidenceRedactedRecordMode",
  "releaseEvidenceRedactedRecordCheckedAt",
  "releaseEvidenceRedactedRecordDoesNotProve",
  "releaseEvidenceRedactedRecordClosesResidual",
  "releaseEvidenceRedactedRecordResidualLedgerUpdated",
  "releaseEvidenceRedactedRecordSafetyFacts",
  "releaseEvidenceRedactedExportHash",
  "releaseEvidenceRedactedUpdateRecordHash",
] as const;

const requiredScalarFields = [
  "releaseId",
  "releasedAt",
  "operator",
  "gitCommit",
  "releaseTag",
  "AREAFORGE_IMAGE",
  "imageDigest",
  "composeHash",
  "nginxConfigHash",
  "previousImage",
  "previousAppVersion",
  "databaseBackupPath",
  "databaseBackupSha256",
  "uploadsBackupPath",
  "uploadsBackupSha256",
  "envBackupPath",
  "envBackupSha256",
  "composeConfigBackupPath",
  "nginxConfigBackupPath",
  "migrationVersion",
  "migrationApplied",
  "migrationRunner",
  "rollbackDecision",
  "rollbackPlan",
  "rollbackDrillResult",
  "rollbackDurationMinutes",
  "databaseRestoreRequired",
  "uploadsRestoreRequired",
  "rollbackFailureReason",
  "residualRisk",
  "followUpTasks",
] as const;

const requiredNestedFields = [
  "preflight.pnpmCheck",
  "preflight.composeConfig",
  "preflight.prodComposeConfig",
  "restoreDrill.databaseImported",
  "restoreDrill.uploadsRestored",
  "restoreDrill.attachmentHashMatched",
  "postReleaseSmoke.health",
  "postReleaseSmoke.login",
  "postReleaseSmoke.dashboard",
  "postReleaseSmoke.taskTimerReview",
  "postReleaseSmoke.syllabusNotesAnalyticsReports",
  "postReleaseSmoke.attachmentSmoke",
  "postReleaseSmoke.aiFallbackOrProvider",
  "expectedFailureOrStopConditions.migrationFailed",
  "expectedFailureOrStopConditions.smokeFailed",
  "expectedFailureOrStopConditions.logLeakDetected",
  "expectedFailureOrStopConditions.attachmentHashMismatch",
  "expectedFailureOrStopConditions.backupMissing",
] as const;

const bundleOptionalFields = [
  "releaseUrl",
  "webImageDigest",
  "migrationImageDigest",
  "sbomAsset",
  "sbomSha256",
  "provenanceAsset",
  "provenanceSha256",
  "supplyChainEvidence",
  "releaseSupplyChainEvidenceHash",
  "signatureVerification",
  "updateAgentStatus",
  "rollbackTargetVersion",
  "rollbackTargetImage",
  "residualRiskIds",
  "operationalEvidenceBundleHash",
  "alertPreviewStatus",
  "attachmentReconciliationCsvSha256",
  "attachmentReconciliationSummaryHash",
  "attachmentReconciliationCsvPath",
  "attachmentReconciliationSummaryPath",
  "attachmentReconciliationStatus",
] as const;

const allowedMetadataFields = [
  "sourceBaseline.sourceDocs",
  "sourceBaseline.sourceHashOrCommit",
  "claimBoundary.doesNotProve",
  "claimBoundary.evidenceStatus",
  "postReleaseSmoke.scope",
  "serverUpdateRecordPath",
  "publicHealthEvidence",
  "readinessSummaryEvidence",
  "operationalEvidenceBundlePath",
  "extraSmokeChecks",
  ...redactedRecordMetadataFields,
] as const;

const yesNoFields = [
  "migrationApplied",
  "databaseRestoreRequired",
  "uploadsRestoreRequired",
  "restoreDrill.databaseImported",
  "restoreDrill.uploadsRestored",
] as const;

const passFailFields = [
  "preflight.pnpmCheck",
  "preflight.composeConfig",
  "preflight.prodComposeConfig",
  "postReleaseSmoke.health",
  "postReleaseSmoke.login",
  "postReleaseSmoke.dashboard",
  "postReleaseSmoke.taskTimerReview",
  "postReleaseSmoke.syllabusNotesAnalyticsReports",
  "postReleaseSmoke.attachmentSmoke",
  "postReleaseSmoke.aiFallbackOrProvider",
] as const;

const secretPatterns = [
  { label: "DATABASE_URL", pattern: /postgres(?:ql)?:\/\/[^ \n]+/i },
  { label: "API key", pattern: /\b(?:sk-|rk-|sess-)[A-Za-z0-9_-]{16,}/ },
  { label: "AUTH_SESSION_SECRET", pattern: /AUTH_SESSION_SECRET\s*=\s*\S+/i },
  { label: "AI_API_KEY", pattern: /AI_API_KEY\s*=\s*\S+/i },
  { label: "raw prompt", pattern: /\b(prompt|rawResponse|fullReviewText|attachmentContent)\b/i },
];

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm release:evidence:validate <release-record.md|txt> <attachment-reconciliation.csv> <attachment-reconciliation-summary.json>");
    process.exit(2);
  }

  const absoluteRecordPath = path.resolve(recordPath);
  const record = readRequiredFile(absoluteRecordPath);
  const reconciliationPath = process.argv[3];
  const reconciliationSummaryPath = process.argv[4];
  const reconciliationCsv = reconciliationPath ? readRequiredFile(path.resolve(reconciliationPath)) : undefined;
  const reconciliationSummary = reconciliationSummaryPath
    ? readRequiredFile(path.resolve(reconciliationSummaryPath))
    : undefined;
  const issues = validateReleaseEvidenceBundle(record, reconciliationCsv, reconciliationSummary);
  const parseIssues: ReleaseEvidenceValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(record, parseIssues);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`release evidence validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("release evidence validation passed: required fields are present, enums are valid, secrets are absent, and bidirectional reconciliation evidence is bound and report_only.");
  console.log(`releaseEvidenceBundleHash: ${buildReleaseEvidenceBundleHash(fields)}`);
  console.log("safetyFacts: dockerCommandAttempted=false backupAttempted=false restoreAttempted=false migrationAttempted=false serverCommandAttempted=false");
}

export function validateReleaseEvidenceBundle(
  record: string,
  reconciliationCsv?: string,
  reconciliationSummary?: string,
): ReleaseEvidenceValidationIssue[] {
  const issues: ReleaseEvidenceValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(record, issues);
  validateRecordShape(fields, issues);
  issues.push(...validateRecord(record, fields));
  const attachmentHashMatched = fields.get("restoreDrill.attachmentHashMatched")?.toLowerCase();
  if (reconciliationCsv !== undefined) {
    issues.push(...validateAttachmentReconciliation(reconciliationCsv, attachmentHashMatched, fields));
  } else if (attachmentHashMatched) {
    issues.push({ field: "attachmentReconciliation", message: `CSV is required when restoreDrill.attachmentHashMatched is ${attachmentHashMatched}` });
  }
  if (reconciliationSummary !== undefined) {
    if (reconciliationCsv === undefined) {
      issues.push({ field: "attachmentReconciliationSummary", message: "requires attachment reconciliation CSV" });
    } else {
      issues.push(...validateReconciliationSummary(
        reconciliationSummary,
        reconciliationCsv,
        attachmentHashMatched,
        fields,
      ));
    }
  } else if (attachmentHashMatched) {
    issues.push({ field: "attachmentReconciliationSummary", message: `is required when restoreDrill.attachmentHashMatched is ${attachmentHashMatched}` });
  }
  return issues;
}

function validateRecordShape(
  fields: Map<string, string>,
  issues: ReleaseEvidenceValidationIssue[],
): void {
  const nestedFields = [...requiredNestedFields, ...allowedMetadataFields.filter((field) => field.includes("."))];
  const sections = nestedFields.map((field) => field.split(".")[0] ?? "");
  const expected = new Set<string>([
    ...requiredScalarFields,
    ...requiredNestedFields,
    ...bundleOptionalFields,
    ...allowedMetadataFields,
    ...sections,
    "releaseEvidenceBundleHash",
  ]);
  for (const field of fields.keys()) {
    if (!expected.has(field)) issues.push({ field, message: "is not allowed in a release evidence record" });
  }
}

function validateRecord(record: string, fields: Map<string, string>): ReleaseEvidenceValidationIssue[] {
  const issues: ReleaseEvidenceValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }
  requireField(fields, "releaseEvidenceBundleHash", issues);
  validateRedactedRecordMetadata(fields, issues);

  for (const field of yesNoFields) {
    const value = fields.get(field);
    if (value && !["yes", "no"].includes(value.toLowerCase())) {
      issues.push({ field, message: "must be yes or no" });
    }
  }

  for (const field of passFailFields) {
    const value = fields.get(field);
    if (value && !["pass", "fail"].includes(value.toLowerCase())) {
      issues.push({ field, message: "must be PASS or FAIL" });
    }
  }

  const attachmentHashMatched = fields.get("restoreDrill.attachmentHashMatched");
  if (attachmentHashMatched && !["yes", "no", "not-applicable"].includes(attachmentHashMatched.toLowerCase())) {
    issues.push({ field: "restoreDrill.attachmentHashMatched", message: "must be yes, no, or not-applicable" });
  }

  const migrationRunner = fields.get("migrationRunner");
  if (migrationRunner && !["controlled_release_workdir", "one_off_migration_job", "not-applicable"].includes(migrationRunner)) {
    issues.push({
      field: "migrationRunner",
      message: "must be controlled_release_workdir, one_off_migration_job, or not-applicable",
    });
  }
  const migrationApplied = fields.get("migrationApplied")?.toLowerCase();
  if (migrationApplied === "yes" && migrationRunner === "not-applicable") {
    issues.push({ field: "migrationRunner", message: "must name the migration deploy runner when migrationApplied is yes" });
  }
  if (migrationApplied === "no" && migrationRunner && migrationRunner !== "not-applicable") {
    issues.push({ field: "migrationRunner", message: "must be not-applicable when migrationApplied is no" });
  }

  const rollbackDurationMinutes = fields.get("rollbackDurationMinutes");
  if (rollbackDurationMinutes && !/^\d+$/.test(rollbackDurationMinutes)) {
    issues.push({ field: "rollbackDurationMinutes", message: "must be a non-negative integer minute count" });
  }

  const operationalEvidenceBundleHash = fields.get("operationalEvidenceBundleHash");
  if (operationalEvidenceBundleHash && !/^(sha256:)?[a-f0-9]{64}$/i.test(operationalEvidenceBundleHash)) {
    issues.push({ field: "operationalEvidenceBundleHash", message: "must be a 64-character sha256 hex digest with optional sha256: prefix" });
  }

  const releaseEvidenceBundleHash = fields.get("releaseEvidenceBundleHash");
  const expectedReleaseEvidenceBundleHash = buildReleaseEvidenceBundleHash(fields);
  if (releaseEvidenceBundleHash) {
    if (!/^(sha256:)?[a-f0-9]{64}$/i.test(releaseEvidenceBundleHash)) {
      issues.push({ field: "releaseEvidenceBundleHash", message: "must be a 64-character sha256 hex digest with optional sha256: prefix" });
    } else if (normalizeSha256(releaseEvidenceBundleHash) !== expectedReleaseEvidenceBundleHash) {
      issues.push({
        field: "releaseEvidenceBundleHash",
        message: `must match computed release evidence bundle hash ${expectedReleaseEvidenceBundleHash}`,
      });
    }
  }

  const releaseSupplyChainEvidenceHash = fields.get("releaseSupplyChainEvidenceHash");
  if (releaseSupplyChainEvidenceHash &&
    releaseSupplyChainEvidenceHash !== "not-applicable" &&
    !/^(sha256:)?[a-f0-9]{64}$/i.test(releaseSupplyChainEvidenceHash)) {
    issues.push({ field: "releaseSupplyChainEvidenceHash", message: "must be not-applicable or a 64-character sha256 hex digest with optional sha256: prefix" });
  }

  const alertPreviewStatus = fields.get("alertPreviewStatus");
  if (alertPreviewStatus && !["ok", "watch", "warning", "critical"].includes(alertPreviewStatus.toLowerCase())) {
    issues.push({ field: "alertPreviewStatus", message: "must be ok, watch, warning, or critical" });
  }

  const attachmentReconciliationStatus = fields.get("attachmentReconciliationStatus");
  if (attachmentReconciliationStatus && !["pass", "mismatch"].includes(attachmentReconciliationStatus)) {
    issues.push({ field: "attachmentReconciliationStatus", message: "must be pass or mismatch" });
  }

  for (const field of ["databaseBackupSha256", "uploadsBackupSha256", "envBackupSha256", "composeHash", "nginxConfigHash"] as const) {
    const value = fields.get(field);
    if (value && !/^[a-f0-9]{64}$/i.test(value)) {
      issues.push({ field, message: "must be a 64-character sha256 hex digest" });
    }
  }

  for (const field of ["sbomSha256", "provenanceSha256"] as const) {
    const value = fields.get(field);
    if (value && value !== "not-applicable" && !/^[a-f0-9]{64}$/i.test(value)) {
      issues.push({ field, message: "must be not-applicable or a 64-character sha256 hex digest" });
    }
  }

  const imageDigest = fields.get("imageDigest");
  if (imageDigest && !/^sha256:[a-f0-9]{64}$/i.test(imageDigest) && !/^[^@\s]+@sha256:[a-f0-9]{64}$/i.test(imageDigest)) {
    issues.push({ field: "imageDigest", message: "must be sha256:<64 hex> or image@sha256:<64 hex>" });
  }

  const image = fields.get("AREAFORGE_IMAGE");
  if (image && (image.includes(":latest") || !/:[^:@\s]+$/.test(image))) {
    issues.push({ field: "AREAFORGE_IMAGE", message: "must use an explicit non-latest tag" });
  }

  for (const item of secretPatterns) {
    if (item.pattern.test(record)) {
      issues.push({ field: "record", message: `must not contain ${item.label}` });
    }
  }

  return issues;
}

function validateRedactedRecordMetadata(
  fields: Map<string, string>,
  issues: ReleaseEvidenceValidationIssue[],
): void {
  if (!redactedRecordMetadataFields.some((field) => fields.has(field))) return;

  for (const field of redactedRecordMetadataFields) requireField(fields, field, issues);
  const expected = releaseEvidenceRedactedRecordContract;
  const exactValues = new Map<string, string>([
    ["releaseEvidenceRedactedRecordMode", expected.mode],
    ["releaseEvidenceRedactedRecordDoesNotProve", expected.doesNotProve],
    ["releaseEvidenceRedactedRecordClosesResidual", "no"],
    ["releaseEvidenceRedactedRecordResidualLedgerUpdated", "no"],
    ["releaseEvidenceRedactedRecordSafetyFacts", expected.safetyFacts],
  ]);
  for (const [field, value] of exactValues) {
    if (fields.get(field) !== value) issues.push({ field, message: `must equal ${value}` });
  }

  const checkedAt = fields.get("releaseEvidenceRedactedRecordCheckedAt") ?? "";
  const timestamp = Date.parse(checkedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== checkedAt) {
    issues.push({ field: "releaseEvidenceRedactedRecordCheckedAt", message: "must be a canonical UTC ISO-8601 timestamp" });
  }
  for (const field of ["releaseEvidenceRedactedExportHash", "releaseEvidenceRedactedUpdateRecordHash"] as const) {
    if (!/^sha256:[a-f0-9]{64}$/.test(fields.get(field) ?? "")) {
      issues.push({ field, message: "must be a canonical lowercase sha256 digest" });
    }
  }
}

function validateAttachmentReconciliation(
  csv: string,
  attachmentHashMatched: string | undefined,
  fields: Map<string, string>,
): ReleaseEvidenceValidationIssue[] {
  const issues: ReleaseEvidenceValidationIssue[] = [];
  for (const item of secretPatterns) {
    if (item.pattern.test(csv)) issues.push({ field: "attachmentReconciliation", message: `must not contain ${item.label}` });
  }
  let rows: ReturnType<typeof parseAttachmentReconciliationCsv>;
  try {
    rows = parseAttachmentReconciliationCsv(csv);
  } catch (error) {
    issues.push({ field: "attachmentReconciliation", message: error instanceof Error ? error.message : "CSV is invalid" });
    return issues;
  }

  if (attachmentHashMatched) {
    const csvPath = fields.get("attachmentReconciliationCsvPath");
    if (!csvPath) issues.push({ field: "attachmentReconciliationCsvPath", message: `is required when attachmentHashMatched is ${attachmentHashMatched}` });
    const expectedHash = fields.get("attachmentReconciliationCsvSha256");
    const actualHash = `sha256:${createHash("sha256").update(csv).digest("hex")}`;
    if (!expectedHash) issues.push({ field: "attachmentReconciliationCsvSha256", message: `is required when attachmentHashMatched is ${attachmentHashMatched}` });
    else if (normalizeSha256(expectedHash) !== actualHash) issues.push({ field: "attachmentReconciliationCsvSha256", message: "does not match the supplied CSV" });
  }
  if (attachmentHashMatched === "yes") {
    if (rows.length === 0) issues.push({ field: "attachmentReconciliation", message: "must contain at least one attachment when attachmentHashMatched is yes" });
    for (const [index, row] of rows.entries()) {
      for (const label of ["exists", "sizeMatches", "hashMatches"] as const) {
        if (row[label] !== "true") {
          issues.push({ field: `attachmentReconciliation.line${index + 2}.${label}`, message: "must be true when restoreDrill.attachmentHashMatched is yes" });
        }
      }
    }
  } else if (attachmentHashMatched === "not-applicable" && rows.length !== 0) {
    issues.push({ field: "attachmentReconciliation", message: "must be header-only when attachmentHashMatched is not-applicable" });
  }

  return issues;
}

function validateReconciliationSummary(
  raw: string,
  csv: string,
  attachmentHashMatched: string | undefined,
  fields: Map<string, string>,
): ReleaseEvidenceValidationIssue[] {
  const issues = validateAttachmentReconciliationSummary(raw, csv)
    .map((message) => ({ field: "attachmentReconciliationSummary", message }));
  for (const item of secretPatterns) {
    if (item.pattern.test(raw)) issues.push({ field: "attachmentReconciliationSummary", message: `must not contain ${item.label}` });
  }
  if (attachmentHashMatched) {
    try {
      const parsed = JSON.parse(raw) as { status?: string; summaryHash?: string; counts?: { databaseRecordCount?: number; uploadFileCount?: number } };
      const expectedStatus = fields.get("attachmentReconciliationStatus");
      const summaryPath = fields.get("attachmentReconciliationSummaryPath");
      if (!summaryPath) issues.push({ field: "attachmentReconciliationSummaryPath", message: `is required when attachmentHashMatched is ${attachmentHashMatched}` });
      if (!expectedStatus) issues.push({ field: "attachmentReconciliationStatus", message: `is required when attachmentHashMatched is ${attachmentHashMatched}` });
      else if (expectedStatus !== parsed.status) issues.push({ field: "attachmentReconciliationStatus", message: "does not match the supplied summary" });
      if (attachmentHashMatched === "yes" && parsed.status !== "pass") {
        issues.push({ field: "attachmentReconciliationSummary.status", message: "must be pass when restoreDrill.attachmentHashMatched is yes" });
      }
      if (attachmentHashMatched === "yes" && !parsed.counts?.databaseRecordCount) {
        issues.push({ field: "attachmentReconciliationSummary.counts.databaseRecordCount", message: "must be greater than zero when attachmentHashMatched is yes" });
      }
      if (attachmentHashMatched === "no" && parsed.status !== "mismatch") {
        issues.push({ field: "attachmentReconciliationSummary.status", message: "must be mismatch when restoreDrill.attachmentHashMatched is no" });
      }
      if (attachmentHashMatched === "not-applicable" && (parsed.status !== "pass" || parsed.counts?.databaseRecordCount !== 0 || parsed.counts?.uploadFileCount !== 0)) {
        issues.push({ field: "attachmentReconciliationSummary", message: "not-applicable requires pass with zero database records and zero upload files" });
      }
      const expectedHash = fields.get("attachmentReconciliationSummaryHash");
      if (!expectedHash) issues.push({ field: "attachmentReconciliationSummaryHash", message: `is required when attachmentHashMatched is ${attachmentHashMatched}` });
      else if (normalizeSha256(expectedHash) !== parsed.summaryHash?.toLowerCase()) issues.push({ field: "attachmentReconciliationSummaryHash", message: "does not match the supplied summary" });
    } catch {
      // Shape validation above reports malformed JSON.
    }
  }
  return issues;
}

function requireField(fields: Map<string, string>, field: string, issues: ReleaseEvidenceValidationIssue[]): void {
  const value = fields.get(field);
  if (!value || value.trim().length === 0) {
    issues.push({ field, message: "is required" });
  }
}

export function buildReleaseEvidenceBundleHash(fields: Map<string, string>): string {
  const keys = [
    ...requiredScalarFields,
    ...requiredNestedFields,
    ...bundleOptionalFields,
  ].filter((key, index, array) => array.indexOf(key) === index).sort();
  const bundle = keys.map((key) => [key, fields.get(key) ?? ""]);
  const hash = createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
  return `sha256:${hash}`;
}

function normalizeSha256(value: string): string {
  const lower = value.toLowerCase();
  return lower.startsWith("sha256:") ? lower : `sha256:${lower}`;
}

function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  return readFileSync(filePath, "utf8");
}

export function resolveReleaseEvidenceValidationArgs(
  recordPath: string,
  root = process.cwd(),
  record?: string,
): string[] {
  const absoluteRecord = path.isAbsolute(recordPath) ? recordPath : path.resolve(root, recordPath);
  if (!existsSync(absoluteRecord)) return [absoluteRecord];
  const parseIssues: ReleaseEvidenceValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(record ?? readFileSync(absoluteRecord, "utf8"), parseIssues);
  if (parseIssues.length > 0) return [absoluteRecord];
  const csv = resolveRecordedEvidencePath(fields.get("attachmentReconciliationCsvPath"), absoluteRecord, root);
  const summary = resolveRecordedEvidencePath(fields.get("attachmentReconciliationSummaryPath"), absoluteRecord, root);
  return [absoluteRecord, ...(csv ? [csv] : []), ...(csv && summary ? [summary] : [])];
}

function resolveRecordedEvidencePath(value: string | undefined, recordPath: string, root: string): string | null {
  if (!value || value.startsWith("<") || value.includes("not-copied") || value.includes("not-applicable")) return null;
  if (path.isAbsolute(value)) return value;
  const recordRelative = path.resolve(path.dirname(recordPath), value);
  const rootRelative = path.resolve(root, value);
  if (existsSync(recordRelative)) return recordRelative;
  if (existsSync(rootRelative)) return rootRelative;
  return recordRelative;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
