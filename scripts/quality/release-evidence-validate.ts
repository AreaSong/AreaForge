import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface ValidationIssue {
  field: string;
  message: string;
}

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
  "migrationVersion",
  "migrationApplied",
  "rollbackDecision",
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

const yesNoFields = [
  "migrationApplied",
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
    console.error("Usage: pnpm release:evidence:validate <release-record.txt> [attachment-reconciliation.csv]");
    process.exit(2);
  }

  const absoluteRecordPath = path.resolve(recordPath);
  const record = readRequiredFile(absoluteRecordPath);
  const fields = parseIndentedKeyValueRecord(record);
  const issues = validateRecord(record, fields);

  const reconciliationPath = process.argv[3];
  if (reconciliationPath) {
    issues.push(...validateAttachmentReconciliation(path.resolve(reconciliationPath)));
  }

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`release evidence validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("release evidence validation passed: required fields are present, enums are valid, secrets are absent, and reconciliation is report_only when provided.");
}

function validateRecord(record: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }

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

  for (const field of ["databaseBackupSha256", "uploadsBackupSha256", "composeHash", "nginxConfigHash"] as const) {
    const value = fields.get(field);
    if (value && !/^[a-f0-9]{64}$/i.test(value)) {
      issues.push({ field, message: "must be a 64-character sha256 hex digest" });
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

function validateAttachmentReconciliation(filePath: string): ValidationIssue[] {
  const csv = readRequiredFile(filePath);
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const issues: ValidationIssue[] = [];
  const expectedHeader = [
    "attachmentId",
    "noteId",
    "uri",
    "metadataHash",
    "fileHash",
    "metadataSizeBytes",
    "fileSizeBytes",
    "exists",
    "sizeMatches",
    "hashMatches",
    "action",
  ].join(",");

  if (lines[0] !== expectedHeader) {
    issues.push({ field: "attachmentReconciliation.header", message: "must match the runbook report_only CSV header" });
    return issues;
  }

  for (const [index, line] of lines.slice(1).entries()) {
    const columns = line.split(",");
    const action = columns[10] ?? "";
    if (action !== "report_only") {
      issues.push({ field: `attachmentReconciliation.line${index + 2}`, message: "action must be report_only" });
    }
  }

  return issues;
}

function requireField(fields: Map<string, string>, field: string, issues: ValidationIssue[]): void {
  const value = fields.get(field);
  if (!value || value.trim().length === 0) {
    issues.push({ field, message: "is required" });
  }
}

function parseIndentedKeyValueRecord(record: string): Map<string, string> {
  const fields = new Map<string, string>();
  let currentSection = "";

  for (const rawLine of record.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const match = rawLine.match(/^(\s*)([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;

    const indent = match[1]?.length ?? 0;
    const key = match[2] ?? "";
    const value = match[3]?.trim() ?? "";
    if (indent === 0) {
      currentSection = value ? "" : key;
      fields.set(key, value);
      continue;
    }

    if (currentSection) {
      fields.set(`${currentSection}.${key}`, value);
    }
  }

  return fields;
}

function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  return readFileSync(filePath, "utf8");
}

main();
