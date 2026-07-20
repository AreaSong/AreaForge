import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type AttachmentCrashWindowIssue = { field: string; message: string };

type ExpectedCase = {
  phase: string;
  fileState: string;
  expectedFileStateAfterCompensation: string;
  metadataState: string;
  compensationAttempted: boolean;
  compensationResult: string;
  expectedOutcome: string;
};

const expectedCases: Record<string, ExpectedCase> = {
  "intent-before-file": { phase: "intent_created", fileState: "absent", expectedFileStateAfterCompensation: "absent", metadataState: "pending", compensationAttempted: false, compensationResult: "not_attempted", expectedOutcome: "resume-staging-or-mark-failed" },
  "staging-write-crash": { phase: "staging_written", fileState: "staged", expectedFileStateAfterCompensation: "staged", metadataState: "pending", compensationAttempted: false, compensationResult: "not_attempted", expectedOutcome: "reconcile-staging-file" },
  "final-before-ready": { phase: "finalized", fileState: "final", expectedFileStateAfterCompensation: "final", metadataState: "pending", compensationAttempted: false, compensationResult: "not_attempted", expectedOutcome: "verify-final-then-mark-ready" },
  "compensation-success": { phase: "compensation", fileState: "final", expectedFileStateAfterCompensation: "absent", metadataState: "pending", compensationAttempted: true, compensationResult: "success", expectedOutcome: "remove-new-file-and-mark-failed" },
  "compensation-failure": { phase: "compensation", fileState: "final", expectedFileStateAfterCompensation: "final", metadataState: "pending", compensationAttempted: true, compensationResult: "failed", expectedOutcome: "retain-pending-for-manual-reconciliation" },
  "restart-reconciliation": { phase: "reconciliation", fileState: "final", expectedFileStateAfterCompensation: "final", metadataState: "pending", compensationAttempted: false, compensationResult: "not_attempted", expectedOutcome: "hash-verify-before-ready-or-failed" },
  "legacy-ready-read": { phase: "ready", fileState: "final", expectedFileStateAfterCompensation: "final", metadataState: "ready", compensationAttempted: false, compensationResult: "not_attempted", expectedOutcome: "read-compatible" },
  "duplicate-storage-identity": { phase: "intent_created", fileState: "absent", expectedFileStateAfterCompensation: "absent", metadataState: "conflict", compensationAttempted: false, compensationResult: "not_attempted", expectedOutcome: "reject-without-file-write" },
  "backup-in-flight-cut": { phase: "backup_snapshot", fileState: "staged", expectedFileStateAfterCompensation: "staged", metadataState: "pending", compensationAttempted: false, compensationResult: "not_attempted", expectedOutcome: "restore-as-pending-and-reconcile" },
};

const requiredDoesNotProve = [
  "production attachment write safety",
  "historical orphan cleanup",
  "backup or restore success",
  "database migration applied",
  "runtime compensation execution",
];

export function validateAttachmentCrashWindow(raw: string): AttachmentCrashWindowIssue[] {
  const issues: AttachmentCrashWindowIssue[] = [];
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return [{ field: "record", message: "must be valid JSON" }];
  }
  if (!isRecord(body)) return [{ field: "record", message: "must be an object" }];

  exactKeys(body, ["schemaVersion", "mode", "status", "action", "cases", "doesNotProve", "safetyFacts", "fixtureHash"], "record", issues);
  if (body.schemaVersion !== 1) issues.push({ field: "schemaVersion", message: "must be 1" });
  if (body.mode !== "fixture_only_attachment_crash_window") issues.push({ field: "mode", message: "must be fixture_only_attachment_crash_window" });
  if (body.status !== "pass") issues.push({ field: "status", message: "must be pass" });
  if (body.action !== "report_only") issues.push({ field: "action", message: "must be report_only" });
  validateCases(body.cases, issues);
  validateDoesNotProve(body.doesNotProve, issues);
  validateSafety(body.safetyFacts, issues);
  rejectSensitiveContent(raw, issues);
  if (!isSha256(body.fixtureHash)) issues.push({ field: "fixtureHash", message: "must be sha256:<64 lowercase hex>" });
  else if (computeAttachmentCrashWindowHash(body) !== body.fixtureHash) issues.push({ field: "fixtureHash", message: "does not match canonical fixture content" });
  return issues;
}

function validateCases(value: unknown, issues: AttachmentCrashWindowIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ field: "cases", message: "must be an array" });
    return;
  }
  const byName = new Map<string, Record<string, unknown>>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push({ field: `cases[${index}]`, message: "must be an object" });
      continue;
    }
    exactKeys(item, ["name", "phase", "expectedOutcome", "fileState", "expectedFileStateAfterCompensation", "metadataState", "compensationAttempted", "compensationResult", "fileDeleted"], `cases[${index}]`, issues);
    if (typeof item.name !== "string" || !item.name) {
      issues.push({ field: `cases[${index}].name`, message: "must be a non-empty string" });
      continue;
    }
    if (byName.has(item.name)) issues.push({ field: `cases[${index}].name`, message: "must be unique" });
    byName.set(item.name, item);
    if (item.fileDeleted !== false) issues.push({ field: `cases[${index}].fileDeleted`, message: "must remain false in fixture-only report" });
  }

  for (const [name, expected] of Object.entries(expectedCases)) {
    const actual = byName.get(name);
    if (!actual) {
      issues.push({ field: "cases", message: `must include ${name}` });
      continue;
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (actual[key] !== expectedValue) issues.push({ field: `cases.${name}.${key}`, message: `must be ${String(expectedValue)}` });
    }
  }
  for (const name of byName.keys()) {
    if (!(name in expectedCases)) issues.push({ field: `cases.${name}`, message: "unknown crash-window case" });
  }
}

function validateDoesNotProve(value: unknown, issues: AttachmentCrashWindowIssue[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push({ field: "doesNotProve", message: "must be an array of strings" });
    return;
  }
  for (const required of requiredDoesNotProve) {
    if (!value.includes(required)) issues.push({ field: "doesNotProve", message: `must include ${required}` });
  }
}

function validateSafety(value: unknown, issues: AttachmentCrashWindowIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "safetyFacts", message: "must be an object" });
    return;
  }
  exactKeys(value, ["readOnly", "databaseWriteAttempted", "fileDeleted", "fileMoved", "metadataRepaired", "productionWriteAttempted", "fileContentIncluded", "absolutePathIncluded", "secretValuePrinted"], "safetyFacts", issues);
  for (const key of ["databaseWriteAttempted", "fileDeleted", "fileMoved", "metadataRepaired", "productionWriteAttempted", "fileContentIncluded", "absolutePathIncluded", "secretValuePrinted"]) {
    if (value[key] !== false) issues.push({ field: `safetyFacts.${key}`, message: "must be false" });
  }
  if (value.readOnly !== true) issues.push({ field: "safetyFacts.readOnly", message: "must be true" });
}

function rejectSensitiveContent(raw: string, issues: AttachmentCrashWindowIssue[]): void {
  const markers = ["postgresql://", "DATABASE_URL", "AUTH_SESSION_SECRET", "/Users/", "/home/", "/etc/", "upload://attachment/"];
  for (const marker of markers) if (raw.includes(marker)) issues.push({ field: "record", message: `must not contain sensitive marker ${marker}` });
}

export function computeAttachmentCrashWindowHash(value: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(stableStringify({ ...value, fixtureHash: "" })).digest("hex")}`;
}

function exactKeys(value: Record<string, unknown>, keys: string[], field: string, issues: AttachmentCrashWindowIssue[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) issues.push({ field, message: `keys must be exactly ${[...keys].sort().join(", ")}` });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function readAttachmentCrashWindowRecord(file: string): AttachmentCrashWindowIssue[] {
  return validateAttachmentCrashWindow(readFileSync(file, "utf8"));
}

if (process.argv[1] && process.argv[1].endsWith("attachment-crash-window-validate.ts")) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: pnpm attachment:crash-window:validate <fixture.json>");
    process.exit(2);
  }
  const issues = readAttachmentCrashWindowRecord(file);
  if (issues.length) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    process.exit(1);
  }
  console.log("attachment crash-window fixture validation passed: strict fixture-only state matrix is valid.");
}
