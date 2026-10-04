import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { computeDataIntegrityDoctorHash } from "../ops/data-integrity-doctor";

type JsonRecord = Record<string, unknown>;
type CheckStatus = "pass" | "warn" | "fail" | "skipped";

const expectedTopLevelKeys = [
  "schemaVersion",
  "mode",
  "generatedAt",
  "status",
  "counts",
  "thresholds",
  "checks",
  "source",
  "doesNotProve",
  "safetyFacts",
  "doctorHash",
];

const expectedDoesNotProve = [
  "automatic data repair or deletion",
  "future concurrency safety after this snapshot",
  "attachment integrity unless a validated reconciliation summary is supplied",
  "production health, backup freshness, updater apply, migration, or rollback execution",
];

const expectedChecks = [
  {
    id: "study_sessions.active_cardinality",
    statuses: ["pass", "fail"],
    messages: {
      pass: "active session cardinality is valid",
      fail: "multiple active study sessions detected",
    },
    detailKeys: ["activeSessionCount", "allowedMaximum"],
  },
  {
    id: "study_sessions.state_consistency",
    statuses: ["pass", "fail"],
    messages: {
      pass: "study session state fields are consistent",
      fail: "study session state contradictions detected",
    },
    detailKeys: [
      "runningWithPausedAtCount",
      "pausedWithoutPausedAtCount",
      "activeWithEndedAtCount",
      "terminalWithoutEndedAtCount",
      "terminalWithPausedAtCount",
      "negativeSessionMetricsCount",
    ],
  },
  {
    id: "study_sessions.stale_active",
    statuses: ["pass", "warn"],
    messages: {
      pass: "no stale active sessions detected",
      warn: "stale active study sessions require review",
    },
    detailKeys: ["staleActiveSessionCount"],
  },
  {
    id: "study_tasks.state_consistency",
    statuses: ["pass", "warn", "fail"],
    messages: {
      pass: "study task state fields are consistent",
      warn: "non-completed tasks retain completedAt and require transition review",
      fail: "study task state contradictions detected",
    },
    detailKeys: [
      "doneWithoutCompletedAtCount",
      "nonDoneWithCompletedAtCount",
      "doneWithDebtCount",
      "negativeTaskMinutesCount",
    ],
  },
  {
    id: "attachments.reconciliation",
    statuses: ["pass", "fail", "skipped"],
    messages: {
      pass: "attachment reconciliation summary is clean",
      fail: "attachment reconciliation summary contains mismatches",
      skipped: "attachment reconciliation summary was not supplied",
    },
    detailKeys: ["databaseRecordCount", "uploadFileCount", "mismatchCount"],
  },
] as const;

export function validateDataIntegrityDoctor(raw: string): string[] {
  const issues: string[] = [];
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return ["doctor output must be valid JSON"];
  }
  if (!isRecord(body)) return ["doctor output must be an object"];

  requireExactKeys(body, expectedTopLevelKeys, "doctor output", issues);
  if (body.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (body.mode !== "read_only_data_integrity_doctor") issues.push("mode is invalid");
  if (!isIsoTimestamp(body.generatedAt)) issues.push("generatedAt must be an ISO timestamp");

  const checks = validateChecks(body.checks, issues);
  validateStatusAndCounts(body.status, body.counts, checks, issues);
  validateThresholds(body.thresholds, issues);
  validateSourceAndSafety(body.source, body.safetyFacts, checks, issues);

  if (JSON.stringify(body.doesNotProve) !== JSON.stringify(expectedDoesNotProve)) {
    issues.push("doesNotProve does not match the redacted doctor contract");
  }
  if (typeof body.doctorHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(body.doctorHash)) {
    issues.push("doctorHash must be canonical sha256");
  } else if (computeDataIntegrityDoctorHash(body) !== body.doctorHash) {
    issues.push("doctorHash does not match canonical content");
  }
  if (containsSensitiveMarker(raw)) issues.push("doctor output contains a URI, path, or sensitive-field marker");
  return issues;
}

function validateChecks(value: unknown, issues: string[]): JsonRecord[] {
  if (!Array.isArray(value) || value.length !== expectedChecks.length) {
    issues.push(`checks must contain exactly ${expectedChecks.length} entries`);
    return [];
  }
  const checks = value.filter(isRecord);
  if (checks.length !== value.length) {
    issues.push("checks entries must be objects");
    return [];
  }
  for (const [index, schema] of expectedChecks.entries()) {
    const item = checks[index];
    requireExactKeys(item, ["id", "status", "message", "details"], `checks[${index}]`, issues);
    if (item.id !== schema.id) issues.push(`checks[${index}].id is invalid`);
    if (!schema.statuses.includes(item.status as never)) issues.push(`checks[${index}].status is invalid`);
    const expectedMessage = schema.messages[item.status as keyof typeof schema.messages];
    if (item.message !== expectedMessage) issues.push(`checks[${index}].message is invalid`);
    if (!isRecord(item.details)) {
      issues.push(`checks[${index}].details must be an object`);
      continue;
    }
    const expectedDetailKeys = schema.id === "attachments.reconciliation" && item.status === "skipped"
      ? []
      : [...schema.detailKeys];
    requireExactKeys(item.details, expectedDetailKeys, `checks[${index}].details`, issues);
    for (const key of expectedDetailKeys) {
      if (!isNonNegativeInteger(item.details[key])) issues.push(`checks[${index}].details.${key} must be a non-negative integer`);
    }
    if (schema.id === "study_sessions.active_cardinality" && item.details.allowedMaximum !== 1) {
      issues.push("checks[0].details.allowedMaximum must be 1");
    }
    const expectedStatus = expectedStatusForCheck(schema.id, item.details, item.status);
    if (expectedStatus && item.status !== expectedStatus) {
      issues.push(`checks[${index}].status does not match detail counts`);
    }
  }
  return checks;
}

function expectedStatusForCheck(id: string, details: JsonRecord, status: unknown): CheckStatus | null {
  if (id === "study_sessions.active_cardinality") {
    return Number(details.activeSessionCount) <= 1 ? "pass" : "fail";
  }
  if (id === "study_sessions.state_consistency") {
    return Object.values(details).some((value) => Number(value) > 0) ? "fail" : "pass";
  }
  if (id === "study_sessions.stale_active") {
    return Number(details.staleActiveSessionCount) > 0 ? "warn" : "pass";
  }
  if (id === "study_tasks.state_consistency") {
    const errorCount = Number(details.doneWithoutCompletedAtCount) +
      Number(details.doneWithDebtCount) +
      Number(details.negativeTaskMinutesCount);
    if (errorCount > 0) return "fail";
    return Number(details.nonDoneWithCompletedAtCount) > 0 ? "warn" : "pass";
  }
  if (id === "attachments.reconciliation") {
    if (status === "skipped") return "skipped";
    return Number(details.mismatchCount) > 0 ? "fail" : "pass";
  }
  return null;
}

function validateStatusAndCounts(statusValue: unknown, countsValue: unknown, checks: JsonRecord[], issues: string[]): void {
  if (!isRecord(statusValue)) {
    issues.push("status must be an object");
    return;
  }
  requireExactKeys(statusValue, ["overall", "native"], "status", issues);
  if (!isRecord(countsValue)) {
    issues.push("counts must be an object");
    return;
  }
  requireExactKeys(countsValue, ["total", "pass", "warn", "fail", "skipped"], "counts", issues);
  const actualCounts = { total: checks.length, pass: 0, warn: 0, fail: 0, skipped: 0 };
  for (const item of checks) {
    if (["pass", "warn", "fail", "skipped"].includes(String(item.status))) {
      actualCounts[item.status as CheckStatus] += 1;
    }
  }
  for (const [key, expected] of Object.entries(actualCounts)) {
    if (countsValue[key] !== expected) issues.push(`counts.${key} does not match checks`);
  }
  const expectedOverall = actualCounts.fail > 0 ? "fail" : actualCounts.warn > 0 || actualCounts.skipped > 0 ? "warn" : "pass";
  const expectedNative = actualCounts.fail > 0 || actualCounts.warn > 0
    ? "integrity_attention"
    : actualCounts.skipped > 0 ? "partial" : "integrity_clean";
  if (statusValue.overall !== expectedOverall) issues.push("status.overall does not match checks");
  if (statusValue.native !== expectedNative) issues.push("status.native does not match checks");
}

function validateThresholds(value: unknown, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push("thresholds must be an object");
    return;
  }
  requireExactKeys(value, ["staleActiveSessionHours"], "thresholds", issues);
  const hours = value.staleActiveSessionHours;
  if (!Number.isInteger(hours) || Number(hours) < 1 || Number(hours) > 168) {
    issues.push("thresholds.staleActiveSessionHours must be an integer from 1 to 168");
  }
}

function validateSourceAndSafety(sourceValue: unknown, safetyValue: unknown, checks: JsonRecord[], issues: string[]): void {
  if (!isRecord(sourceValue)) {
    issues.push("source must be an object");
    return;
  }
  requireExactKeys(sourceValue, ["database", "attachmentSummarySha256"], "source", issues);
  if (!["configured_read_only_query", "fixture"].includes(String(sourceValue.database))) issues.push("source.database is invalid");
  const attachmentCheck = checks.find((item) => item.id === "attachments.reconciliation");
  const attachmentSkipped = attachmentCheck?.status === "skipped";
  if (attachmentSkipped && sourceValue.attachmentSummarySha256 !== null) {
    issues.push("source.attachmentSummarySha256 must be null when attachment reconciliation is skipped");
  }
  if (!attachmentSkipped && (typeof sourceValue.attachmentSummarySha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(sourceValue.attachmentSummarySha256))) {
    issues.push("source.attachmentSummarySha256 must bind the supplied attachment summary");
  }

  if (!isRecord(safetyValue)) {
    issues.push("safetyFacts must be an object");
    return;
  }
  const safetyKeys = [
    "readOnly",
    "networkRequested",
    "databaseReadAttempted",
    "databaseWriteAttempted",
    "uploadDirectoryReadAttempted",
    "fileWriteAttempted",
    "attachmentContentIncluded",
    "objectIdentifiersIncluded",
    "absolutePathIncluded",
    "secretValuePrinted",
  ];
  requireExactKeys(safetyValue, safetyKeys, "safetyFacts", issues);
  const databaseRecord = sourceValue.database === "configured_read_only_query";
  const expectedSafety: JsonRecord = {
    readOnly: true,
    networkRequested: databaseRecord,
    databaseReadAttempted: databaseRecord,
    databaseWriteAttempted: false,
    uploadDirectoryReadAttempted: false,
    fileWriteAttempted: false,
    attachmentContentIncluded: false,
    objectIdentifiersIncluded: false,
    absolutePathIncluded: false,
    secretValuePrinted: false,
  };
  for (const [key, expected] of Object.entries(expectedSafety)) {
    if (safetyValue[key] !== expected) issues.push(`safetyFacts.${key} is inconsistent with source and read-only boundary`);
  }
}

function requireExactKeys(value: JsonRecord, keys: readonly string[], field: string, issues: string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) issues.push(`${field} fields are incomplete or unknown`);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isIsoTimestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function containsSensitiveMarker(raw: string): boolean {
  return /(?:\b[a-z][a-z0-9+.-]*:\/\/|(?:^|["\s:])\/(?:Users|opt|var|etc|home|srv|private|Volumes|tmp)\/|[A-Za-z]:\\|"(?:title|uri|path|password|secret|token|content)"\s*:)/im.test(raw);
}

function main(): void {
  const file = process.argv.slice(2).filter((arg) => arg !== "--")[0];
  if (!file || !existsSync(file)) {
    console.error("Usage: pnpm ops:data-integrity:validate <data-integrity-doctor.json>");
    process.exit(2);
  }
  const issues = validateDataIntegrityDoctor(readFileSync(path.resolve(file), "utf8"));
  if (issues.length > 0) {
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  console.log("data integrity doctor validation passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
