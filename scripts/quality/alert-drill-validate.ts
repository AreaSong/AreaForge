import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface ValidationIssue {
  field: string;
  message: string;
}

const requiredScalarFields = [
  "drillId",
  "drilledAt",
  "operator",
  "environment",
  "scope",
  "scenario",
  "alertPreviewCommand",
  "alertPreviewStatus",
  "alertPreviewWouldNotify",
  "alertPreviewEvidenceHash",
  "alertReceiverType",
  "receiverConfigured",
  "receiverAck",
  "detectionResult",
  "recoveryResult",
  "recoveryAction",
  "residualRiskIds",
  "followUpTasks",
] as const;

const requiredNestedFields = [
  "safetyFacts.notificationSent",
  "safetyFacts.externalAlertReceiverCalled",
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.secretValuePrinted",
] as const;

const yesNoFields = [
  "alertPreviewWouldNotify",
  "receiverConfigured",
  "safetyFacts.notificationSent",
  "safetyFacts.externalAlertReceiverCalled",
  "safetyFacts.serverCommandAttempted",
  "safetyFacts.productionWriteAttempted",
  "safetyFacts.secretValuePrinted",
] as const;

const passFailFields = ["detectionResult", "recoveryResult"] as const;

const secretPatterns = [
  { label: "DATABASE_URL", pattern: /postgres(?:ql)?:\/\/[^ \n]+/i },
  { label: "API key", pattern: /\b(?:sk-|rk-|sess-)[A-Za-z0-9_-]{16,}/ },
  { label: "AUTH_SESSION_SECRET", pattern: /AUTH_SESSION_SECRET\s*=\s*\S+/i },
  { label: "AI_API_KEY", pattern: /AI_API_KEY\s*=\s*\S+/i },
  { label: "cookie", pattern: /\b(?:session|cookie)\s*[:=]\s*[A-Za-z0-9._=-]{16,}/i },
  { label: "raw prompt", pattern: /\b(prompt|rawResponse|fullReviewText|attachmentContent)\b/i },
];

function main(): void {
  const recordPath = process.argv[2];
  if (!recordPath) {
    console.error("Usage: pnpm alert:drill:validate <alert-drill-record.md|txt>");
    process.exit(2);
  }

  const absoluteRecordPath = path.resolve(recordPath);
  const record = readRequiredFile(absoluteRecordPath);
  const fields = parseIndentedKeyValueRecord(record);
  const issues = validateRecord(record, fields);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.field}: ${issue.message}`);
    }
    console.error(`alert drill validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("alert drill validation passed: required fields are present, enums are valid, OPS-004 is tracked, and secrets are absent.");
  console.log(`alertDrillEvidenceHash: ${buildAlertDrillEvidenceHash(fields)}`);
  console.log("safetyFacts: notificationSent=recorded externalAlertReceiverCalled=recorded serverCommandAttempted=false productionWriteAttempted=false secretValuePrinted=false");
}

function validateRecord(record: string, fields: Map<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of requiredScalarFields) {
    requireField(fields, field, issues);
  }
  for (const field of requiredNestedFields) {
    requireField(fields, field, issues);
  }

  requireOneOf(fields, "environment", ["production", "staging", "local", "ci"], issues);
  requireOneOf(fields, "scope", ["daily", "release", "update", "migration", "rollback"], issues);
  requireOneOf(fields, "scenario", ["health_failure", "smoke_missing", "backup_stale", "cert_expiring", "update_agent_blocker", "release_identity_missing", "manual"], issues);
  requireOneOf(fields, "alertPreviewStatus", ["ok", "watch", "warning", "critical"], issues);
  requireOneOf(fields, "alertReceiverType", ["external", "manual-window"], issues);
  requireOneOf(fields, "receiverAck", ["yes", "no", "not-applicable"], issues);

  for (const field of yesNoFields) {
    requireOneOf(fields, field, ["yes", "no"], issues);
  }
  for (const field of passFailFields) {
    requireOneOf(fields, field, ["pass", "fail"], issues);
  }

  const command = fields.get("alertPreviewCommand");
  if (command && !command.includes("pnpm ops:alert:preview")) {
    issues.push({ field: "alertPreviewCommand", message: "must reference pnpm ops:alert:preview" });
  }

  const evidenceHash = fields.get("alertPreviewEvidenceHash");
  if (evidenceHash && !/^(sha256:)?[a-f0-9]{64}$/i.test(evidenceHash)) {
    issues.push({ field: "alertPreviewEvidenceHash", message: "must be a 64-character sha256 hex digest with optional sha256: prefix" });
  }

  if (fields.get("receiverConfigured")?.toLowerCase() !== "yes") {
    issues.push({ field: "receiverConfigured", message: "must be yes for an OPS-004 closure drill record" });
  }
  if (fields.get("receiverAck")?.toLowerCase() !== "yes") {
    issues.push({ field: "receiverAck", message: "must be yes for an OPS-004 closure drill record" });
  }
  if (fields.get("detectionResult")?.toLowerCase() !== "pass") {
    issues.push({ field: "detectionResult", message: "must be PASS for an OPS-004 closure drill record" });
  }
  if (fields.get("recoveryResult")?.toLowerCase() !== "pass") {
    issues.push({ field: "recoveryResult", message: "must be PASS for an OPS-004 closure drill record" });
  }
  if (!fields.get("residualRiskIds")?.includes("AF-RISK-OPS-004")) {
    issues.push({ field: "residualRiskIds", message: "must include AF-RISK-OPS-004" });
  }

  for (const field of ["safetyFacts.serverCommandAttempted", "safetyFacts.productionWriteAttempted", "safetyFacts.secretValuePrinted"] as const) {
    if (fields.get(field)?.toLowerCase() !== "no") {
      issues.push({ field, message: "must be no" });
    }
  }

  for (const item of secretPatterns) {
    if (item.pattern.test(record)) {
      issues.push({ field: "record", message: `must not contain ${item.label}` });
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

function requireOneOf(
  fields: Map<string, string>,
  field: string,
  allowed: string[],
  issues: ValidationIssue[],
): void {
  const value = fields.get(field);
  if (value && !allowed.includes(value.toLowerCase())) {
    issues.push({ field, message: `must be one of ${allowed.join(", ")}` });
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

function buildAlertDrillEvidenceHash(fields: Map<string, string>): string {
  const keys = [
    ...requiredScalarFields,
    ...requiredNestedFields,
  ].filter((key, index, array) => array.indexOf(key) === index).sort();
  const bundle = keys.map((key) => [key, fields.get(key) ?? ""]);
  const hash = createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
  return `sha256:${hash}`;
}

function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  return readFileSync(filePath, "utf8");
}

main();
