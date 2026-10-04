import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseIndentedKeyValueRecord,
  scanForSecrets,
  type ValidationIssue,
} from "./record-validator-common";

type JsonRecord = Record<string, unknown>;
export type ObservationGateStatus = "pending_observation" | "pass" | "fail";
export type DateStatus = "upcoming" | "due_today" | "overdue";
export type EvidenceReference = { path: string; sha256: string };
export type ObservationGate = { status: ObservationGateStatus; reasons: string[] };
export type ObservationItem<T extends string> = { status: T; summary: string; evidence: EvidenceReference[] };

export type D14Checkpoint = {
  dueDate: string;
  observedAt: string | null;
  technicalObservation: ObservationItem<"pending_observation" | "pass" | "fail">;
  incident: ObservationItem<"pending_observation" | "none" | "resolved" | "open">;
  errorBudget: ObservationItem<"pending_observation" | "within_budget" | "exhausted">;
  gate: ObservationGate;
};

export type D30Checkpoint = {
  dueDate: string;
  observedAt: string | null;
  productReview: ObservationItem<"pending_observation" | "pass" | "fail">;
  gate: ObservationGate;
};

export type PostReleaseObservationRecord = {
  schemaVersion: 1;
  mode: "post_release_observation";
  release: {
    version: string;
    releaseTag: string;
    releasedAt: string;
    gitCommit: string;
    releaseRecord: EvidenceReference;
  };
  checkpoints: { d14: D14Checkpoint; d30: D30Checkpoint };
  gate: ObservationGate;
  safetyFacts: {
    readOnlyEvidence: true;
    networkRequested: false;
    productionWriteAttempted: false;
    residualLedgerUpdated: false;
    fileWriteAttempted: false;
  };
};

export type ValidationOptions = { root?: string; verifyFileHashes?: boolean };

const topLevelKeys = ["schemaVersion", "mode", "release", "checkpoints", "gate", "safetyFacts"];
const d14Keys = ["dueDate", "observedAt", "technicalObservation", "incident", "errorBudget", "gate"];
const d30Keys = ["dueDate", "observedAt", "productReview", "gate"];
const itemKeys = ["status", "summary", "evidence"];
const evidenceKeys = ["path", "sha256"];
const gateKeys = ["status", "reasons"];

export function validatePostReleaseObservation(raw: string, options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  scanForSecrets(raw, issues);
  const body = parseRecord(raw, issues);
  if (!body) return issues;

  exactKeys(body, topLevelKeys, "record", issues);
  requireValue(body.schemaVersion, "schemaVersion", 1, issues);
  requireValue(body.mode, "mode", "post_release_observation", issues);
  validateRelease(body.release, options, issues);
  validateCheckpoints(body.checkpoints, body.release, options, issues);
  validateOverallGate(body.gate, body.checkpoints, issues);
  validateSafetyFacts(body.safetyFacts, issues);
  return issues;
}

export function parsePostReleaseObservation(raw: string): PostReleaseObservationRecord {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error("post-release observation record must be an object");
  return parsed as unknown as PostReleaseObservationRecord;
}

export function deriveD14Gate(checkpoint: Pick<D14Checkpoint, "technicalObservation" | "incident" | "errorBudget">): ObservationGate {
  const failures: string[] = [];
  if (checkpoint.technicalObservation.status === "fail") failures.push("technical_observation_failed");
  if (checkpoint.incident.status === "open") failures.push("incident_open");
  if (checkpoint.errorBudget.status === "exhausted") failures.push("error_budget_exhausted");
  if (failures.length > 0) return { status: "fail", reasons: failures };

  const pending: string[] = [];
  if (checkpoint.technicalObservation.status === "pending_observation") pending.push("technical_observation_pending");
  if (checkpoint.incident.status === "pending_observation") pending.push("incident_observation_pending");
  if (checkpoint.errorBudget.status === "pending_observation") pending.push("error_budget_observation_pending");
  return pending.length > 0
    ? { status: "pending_observation", reasons: pending }
    : { status: "pass", reasons: ["d14_observation_passed"] };
}

export function deriveD30Gate(checkpoint: Pick<D30Checkpoint, "productReview">): ObservationGate {
  if (checkpoint.productReview.status === "fail") return { status: "fail", reasons: ["product_review_failed"] };
  if (checkpoint.productReview.status === "pending_observation") return { status: "pending_observation", reasons: ["product_review_pending"] };
  return { status: "pass", reasons: ["d30_product_review_passed"] };
}

export function deriveOverallGate(checkpoints: PostReleaseObservationRecord["checkpoints"]): ObservationGate {
  const failures = (["d14", "d30"] as const)
    .filter((key) => checkpoints[key].gate.status === "fail")
    .map((key) => `${key}_failed`);
  if (failures.length > 0) return { status: "fail", reasons: failures };
  const pending = (["d14", "d30"] as const)
    .filter((key) => checkpoints[key].gate.status === "pending_observation")
    .map((key) => `${key}_pending_observation`);
  return pending.length > 0
    ? { status: "pending_observation", reasons: pending }
    : { status: "pass", reasons: ["d14_and_d30_passed"] };
}

export function addUtcCalendarDays(timestamp: string, days: number): string | null {
  if (!isUtcTimestamp(timestamp)) return null;
  const date = new Date(`${timestamp.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function observationDateStatus(dueDate: string, asOf: string): DateStatus {
  if (dueDate === asOf) return "due_today";
  return dueDate < asOf ? "overdue" : "upcoming";
}

function validateRelease(value: unknown, options: ValidationOptions, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "release", message: "must be an object" });
    return;
  }
  exactKeys(value, ["version", "releaseTag", "releasedAt", "gitCommit", "releaseRecord"], "release", issues);
  if (typeof value.version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version)) {
    issues.push({ field: "release.version", message: "must be a stable semantic version" });
  }
  if (value.releaseTag !== `v${String(value.version)}`) issues.push({ field: "release.releaseTag", message: "must equal v + release.version" });
  if (!isUtcTimestamp(value.releasedAt)) issues.push({ field: "release.releasedAt", message: "must be an ISO-8601 UTC timestamp" });
  if (typeof value.gitCommit !== "string" || !/^[a-f0-9]{40}$/.test(value.gitCommit)) issues.push({ field: "release.gitCommit", message: "must be a 40-character lowercase git commit" });

  const expectedPath = typeof value.version === "string" ? `docs/development/release-v${value.version}-record.md` : null;
  validateEvidenceReference(value.releaseRecord, "release.releaseRecord", options, issues, expectedPath);
  validateReleaseRecordIdentity(value, options, issues);
}

function validateReleaseRecordIdentity(release: JsonRecord, options: ValidationOptions, issues: ValidationIssue[]): void {
  if (options.verifyFileHashes === false || !isRecord(release.releaseRecord) || !isSafeRelativePath(release.releaseRecord.path)) return;
  const file = resolveRegularFile(release.releaseRecord.path, options.root, "release.releaseRecord.path", issues);
  if (!file) return;
  const fields = parseIndentedKeyValueRecord(readFileSync(file, "utf8"));
  for (const key of ["releaseTag", "releasedAt", "gitCommit"] as const) {
    if (fields.get(key) !== release[key]) issues.push({ field: `release.releaseRecord.${key}`, message: `must match release.${key}` });
  }
}

function validateCheckpoints(value: unknown, release: unknown, options: ValidationOptions, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "checkpoints", message: "must be an object" });
    return;
  }
  exactKeys(value, ["d14", "d30"], "checkpoints", issues);
  const releasedAt = isRecord(release) && typeof release.releasedAt === "string" ? release.releasedAt : "";
  validateD14(value.d14, addUtcCalendarDays(releasedAt, 14), options, issues);
  validateD30(value.d30, addUtcCalendarDays(releasedAt, 30), options, issues);
}

function validateD14(value: unknown, expectedDate: string | null, options: ValidationOptions, issues: ValidationIssue[]): void {
  const field = "checkpoints.d14";
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  exactKeys(value, d14Keys, field, issues);
  validateDueDate(value.dueDate, `${field}.dueDate`, expectedDate, issues);
  validateObservationItem(value.technicalObservation, `${field}.technicalObservation`, ["pending_observation", "pass", "fail"], options, issues);
  validateObservationItem(value.incident, `${field}.incident`, ["pending_observation", "none", "resolved", "open"], options, issues);
  validateObservationItem(value.errorBudget, `${field}.errorBudget`, ["pending_observation", "within_budget", "exhausted"], options, issues);
  validateObservedAt(value.observedAt, [value.technicalObservation, value.incident, value.errorBudget], field, issues);
  if (hasStatuses(value, ["technicalObservation", "incident", "errorBudget"])) validateGate(value.gate, `${field}.gate`, deriveD14Gate(value as unknown as D14Checkpoint), issues);
}

function validateD30(value: unknown, expectedDate: string | null, options: ValidationOptions, issues: ValidationIssue[]): void {
  const field = "checkpoints.d30";
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  exactKeys(value, d30Keys, field, issues);
  validateDueDate(value.dueDate, `${field}.dueDate`, expectedDate, issues);
  validateObservationItem(value.productReview, `${field}.productReview`, ["pending_observation", "pass", "fail"], options, issues);
  validateObservedAt(value.observedAt, [value.productReview], field, issues);
  if (hasStatuses(value, ["productReview"])) validateGate(value.gate, `${field}.gate`, deriveD30Gate(value as unknown as D30Checkpoint), issues);
}

function validateObservationItem(value: unknown, field: string, allowed: string[], options: ValidationOptions, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  exactKeys(value, itemKeys, field, issues);
  if (typeof value.status !== "string" || !allowed.includes(value.status)) issues.push({ field: `${field}.status`, message: `must be one of ${allowed.join(", ")}` });
  if (typeof value.summary !== "string" || value.summary.trim().length === 0) issues.push({ field: `${field}.summary`, message: "must be a non-empty string" });
  if (!Array.isArray(value.evidence)) {
    issues.push({ field: `${field}.evidence`, message: "must be an array" });
    return;
  }
  if (value.status !== "pending_observation" && value.evidence.length === 0) issues.push({ field: `${field}.evidence`, message: "must contain evidence when observation is complete" });
  const paths = new Set<string>();
  for (const [index, evidence] of value.evidence.entries()) {
    validateEvidenceReference(evidence, `${field}.evidence[${index}]`, options, issues, null);
    if (isRecord(evidence) && typeof evidence.path === "string") {
      if (paths.has(evidence.path)) issues.push({ field: `${field}.evidence`, message: "must not contain duplicate paths" });
      paths.add(evidence.path);
    }
  }
}

function validateEvidenceReference(value: unknown, field: string, options: ValidationOptions, issues: ValidationIssue[], expectedPath: string | null): void {
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  exactKeys(value, evidenceKeys, field, issues);
  if (!isSafeRelativePath(value.path)) issues.push({ field: `${field}.path`, message: "must be a safe repository-relative path" });
  else if (expectedPath && value.path !== expectedPath) issues.push({ field: `${field}.path`, message: `must be ${expectedPath}` });
  if (!isSha256(value.sha256)) issues.push({ field: `${field}.sha256`, message: "must be sha256:<64 lowercase hex>" });
  if (options.verifyFileHashes === false || !isSafeRelativePath(value.path) || !isSha256(value.sha256)) return;
  const file = resolveRegularFile(value.path, options.root, `${field}.path`, issues);
  if (!file) return;
  const actual = `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
  if (actual !== value.sha256) issues.push({ field: `${field}.sha256`, message: "must match the referenced file bytes" });
}

function resolveRegularFile(relative: string, rootOption: string | undefined, field: string, issues: ValidationIssue[]): string | null {
  const root = path.resolve(rootOption ?? process.cwd());
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file)) {
    issues.push({ field, message: "must reference an existing file under the repository root" });
    return null;
  }
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) {
    issues.push({ field, message: "must not reference a symbolic link" });
    return null;
  }
  if (!stat.isFile()) {
    issues.push({ field, message: "must reference a regular file" });
    return null;
  }
  return file;
}

function validateDueDate(value: unknown, field: string, expected: string | null, issues: ValidationIssue[]): void {
  if (!isDateOnly(value)) issues.push({ field, message: "must be an exact YYYY-MM-DD date" });
  else if (expected && value !== expected) issues.push({ field, message: `must be ${expected}` });
}

function validateObservedAt(value: unknown, items: unknown[], field: string, issues: ValidationIssue[]): void {
  const statuses = items.map((item) => isRecord(item) ? item.status : undefined);
  const allPending = statuses.length > 0 && statuses.every((status) => status === "pending_observation");
  if (allPending && value !== null) issues.push({ field: `${field}.observedAt`, message: "must be null while every observation is pending" });
  if (!allPending && !isUtcTimestamp(value)) issues.push({ field: `${field}.observedAt`, message: "must be an ISO-8601 UTC timestamp once observation has started" });
}

function validateOverallGate(value: unknown, checkpoints: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(checkpoints) || !hasGate(checkpoints.d14) || !hasGate(checkpoints.d30)) return;
  validateGate(value, "gate", deriveOverallGate(checkpoints as unknown as PostReleaseObservationRecord["checkpoints"]), issues);
}

function validateGate(value: unknown, field: string, expected: ObservationGate, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  exactKeys(value, gateKeys, field, issues);
  if (value.status !== expected.status) issues.push({ field: `${field}.status`, message: `must be derived as ${expected.status}` });
  if (!sameStringArray(value.reasons, expected.reasons)) issues.push({ field: `${field}.reasons`, message: `must be exactly ${expected.reasons.join(", ")}` });
}

function validateSafetyFacts(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "safetyFacts", message: "must be an object" });
    return;
  }
  const expected = { readOnlyEvidence: true, networkRequested: false, productionWriteAttempted: false, residualLedgerUpdated: false, fileWriteAttempted: false } as const;
  exactKeys(value, Object.keys(expected), "safetyFacts", issues);
  for (const [key, expectedValue] of Object.entries(expected)) requireValue(value[key], `safetyFacts.${key}`, expectedValue, issues);
}

function parseRecord(raw: string, issues: ValidationIssue[]): JsonRecord | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      issues.push({ field: "record", message: "must be a JSON object" });
      return null;
    }
    return parsed;
  } catch (error) {
    issues.push({ field: "record", message: error instanceof Error ? error.message : "must be valid JSON" });
    return null;
  }
}

function hasStatuses(value: JsonRecord, keys: string[]): boolean {
  return keys.every((key) => isRecord(value[key]) && typeof value[key].status === "string");
}

function hasGate(value: unknown): boolean {
  return isRecord(value) && isRecord(value.gate) && ["pending_observation", "pass", "fail"].includes(String(value.gate.status));
}

function exactKeys(value: JsonRecord, expected: string[], field: string, issues: ValidationIssue[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) issues.push({ field, message: `keys must be exactly ${[...expected].sort().join(", ")}` });
}

function requireValue(value: unknown, field: string, expected: unknown, issues: ValidationIssue[]): void {
  if (value !== expected) issues.push({ field, message: `must be ${String(expected)}` });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString() === (value.includes(".") ? value : value.replace("Z", ".000Z"));
}

function isSafeRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && !value.includes("\\") && !value.split("/").includes("..") && value !== ".";
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function sameStringArray(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function main(): void {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: pnpm release:post-observation:validate <post-release-observation.json>");
    process.exit(2);
  }
  const issues = validatePostReleaseObservation(readFileSync(path.resolve(file), "utf8"));
  if (issues.length > 0) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    console.error(`post-release observation validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }
  console.log("post-release observation validation passed: strict schema V1, Release identity, D14/D30 checkpoints, structured evidence, and derived gates are valid.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
