import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type UpdaterPhaseJournalIssue = { field: string; message: string };

const normalPhases = ["validated", "backup", "migration", "switch", "health", "smoke"] as const;
const requiredPassSequence: Array<{ phase: string; state: string }> = [
  ...normalPhases.flatMap((phase): Array<{ phase: string; state: string }> => [
    { phase, state: "started" },
    { phase, state: "complete" },
  ]),
  { phase: "terminal", state: "started" },
  { phase: "terminal", state: "applied" },
];

const requiredDoesNotProve = [
  "production updater phase durability",
  "migration success",
  "timer or queue suspension",
  "rollback execution",
  "append-only event durability",
];

export function validateUpdaterPhaseJournal(raw: string): UpdaterPhaseJournalIssue[] {
  const issues: UpdaterPhaseJournalIssue[] = [];
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return [{ field: "record", message: "must be valid JSON" }];
  }
  if (!isRecord(body)) return [{ field: "record", message: "must be an object" }];

  exactKeys(body, ["schemaVersion", "mode", "status", "operationId", "release", "events", "executionAttempted", "doesNotProve", "safetyFacts", "journalHash"], "record", issues);
  if (body.schemaVersion !== 1) issues.push({ field: "schemaVersion", message: "must be 1" });
  if (body.mode !== "fixture_only_updater_phase_journal") issues.push({ field: "mode", message: "must be fixture_only_updater_phase_journal" });
  if (body.status !== "pass" && body.status !== "reconciliation_required") issues.push({ field: "status", message: "must be pass or reconciliation_required" });
  if (typeof body.operationId !== "string" || !/^fixture_[a-z0-9_-]{8,80}$/.test(body.operationId)) issues.push({ field: "operationId", message: "must be a safe fixture identifier" });
  if (body.executionAttempted !== false) issues.push({ field: "executionAttempted", message: "must remain false for fixture-only evidence" });
  validateRelease(body.release, issues);
  validateEvents(body.events, body.status, body.operationId, body.release, issues);
  validateDoesNotProve(body.doesNotProve, issues);
  validateSafety(body.safetyFacts, issues);
  rejectSensitiveContent(raw, issues);
  if (!isSha256(body.journalHash)) issues.push({ field: "journalHash", message: "must be sha256:<64 lowercase hex>" });
  else if (computeUpdaterPhaseJournalHash(body) !== body.journalHash) issues.push({ field: "journalHash", message: "does not match canonical journal content" });
  return issues;
}

function validateRelease(value: unknown, issues: UpdaterPhaseJournalIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "release", message: "must be an object" });
    return;
  }
  exactKeys(value, ["tag", "version", "manifestSha256", "webImageDigest", "migrationImageDigest"], "release", issues);
  if (typeof value.tag !== "string" || !/^v\d+\.\d+\.\d+$/.test(value.tag)) issues.push({ field: "release.tag", message: "must be vX.Y.Z" });
  if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version)) issues.push({ field: "release.version", message: "must be X.Y.Z" });
  if (typeof value.tag === "string" && typeof value.version === "string" && value.tag !== `v${value.version}`) issues.push({ field: "release", message: "tag and version must match" });
  if (!isSha256(value.manifestSha256)) issues.push({ field: "release.manifestSha256", message: "must be sha256" });
  for (const key of ["webImageDigest", "migrationImageDigest"]) {
    if (typeof value[key] !== "string" || !/^ghcr\.io\/[a-z0-9._/-]+:v\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/.test(value[key])) issues.push({ field: `release.${key}`, message: "must bind a tagged immutable GHCR digest" });
    else if (typeof value.tag === "string" && !value[key].includes(`:${value.tag}@sha256:`)) issues.push({ field: `release.${key}`, message: "embedded image tag must match release.tag" });
  }
}

function validateEvents(value: unknown, status: unknown, operationId: unknown, release: unknown, issues: UpdaterPhaseJournalIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ field: "events", message: "must contain ordered phase events" });
    return;
  }
  let previousHash: string | null = null;
  const normalized: Array<{ phase: unknown; state: unknown }> = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push({ field: `events[${index}]`, message: "must be an object" });
      continue;
    }
    exactKeys(item, ["sequence", "operationId", "release", "phase", "state", "reasonCode", "uncertainPhase", "sourceKind", "source", "requestId", "requestHash", "createdAt", "executionAttempted", "previousEventHash", "eventHash"], `events[${index}]`, issues);
    if (item.sequence !== index + 1) issues.push({ field: `events[${index}].sequence`, message: "must be contiguous" });
    if (item.operationId !== operationId) issues.push({ field: `events[${index}].operationId`, message: "must match record operationId" });
    if (stableStringify(item.release) !== stableStringify(release)) issues.push({ field: `events[${index}].release`, message: "must match record release identity" });
    if (typeof item.reasonCode !== "string" || !/^[A-Z0-9_]{2,80}$/.test(item.reasonCode)) issues.push({ field: `events[${index}].reasonCode`, message: "must be a redacted stable code" });
    validateEventIdentity(item, index, issues);
    validateEventTime(item, index, value, issues);
    if (item.phase !== "reconciliation" && item.uncertainPhase !== null) issues.push({ field: `events[${index}].uncertainPhase`, message: "must be null outside reconciliation events" });
    if (item.executionAttempted !== false) issues.push({ field: `events[${index}].executionAttempted`, message: "must remain false in fixture-only evidence" });
    if (item.previousEventHash !== previousHash) issues.push({ field: `events[${index}].previousEventHash`, message: "must match the preceding event hash" });
    if (!isSha256(item.eventHash)) issues.push({ field: `events[${index}].eventHash`, message: "must be sha256" });
    else if (computeUpdaterPhaseEventHash(item) !== item.eventHash) issues.push({ field: `events[${index}].eventHash`, message: "does not match canonical event content" });
    previousHash = typeof item.eventHash === "string" ? item.eventHash : null;
    normalized.push({ phase: item.phase, state: item.state });
  }

  if (status === "pass") {
    if (JSON.stringify(normalized) !== JSON.stringify(requiredPassSequence)) issues.push({ field: "events", message: "pass journal must contain the full started/complete phase chain and terminal applied event" });
    if (value.some((item) => isRecord(item) && item.phase === "reconciliation")) issues.push({ field: "events", message: "pass journal cannot contain reconciliation" });
    return;
  }

  const last = value[value.length - 1];
  if (!isRecord(last) || last.phase !== "reconciliation" || last.state !== "reconciliation_required") {
    issues.push({ field: "events", message: "reconciliation_required journal must end with reconciliation_required" });
    return;
  }
  const uncertainPhase = last.uncertainPhase;
  const allowedUncertainPhases = [...normalPhases, "terminal"];
  if (typeof uncertainPhase !== "string" || !allowedUncertainPhases.includes(uncertainPhase)) {
    issues.push({ field: "events.reconciliation.uncertainPhase", message: "must identify the uncertain operational or terminal phase" });
    return;
  }
  const startedIndex = requiredPassSequence.findIndex((item) => item.phase === uncertainPhase && item.state === "started");
  const expectedPrefix = requiredPassSequence.slice(0, startedIndex + 1);
  const priorSequence = normalized.slice(0, -1);
  if (startedIndex < 0 || JSON.stringify(priorSequence) !== JSON.stringify(expectedPrefix)) {
    issues.push({ field: "events", message: "reconciliation journal must contain the complete phase prefix through the uncertain started event" });
  }
}

function validateEventIdentity(item: Record<string, unknown>, index: number, issues: UpdaterPhaseJournalIssue[]): void {
  const field = `events[${index}]`;
  if (item.sourceKind !== "automatic" && item.sourceKind !== "operator" && item.sourceKind !== "request") {
    issues.push({ field: `${field}.sourceKind`, message: "must be automatic, operator, or request" });
  }
  if (typeof item.source !== "string" || !/^[a-z][a-z0-9._:-]{1,79}$/.test(item.source)) {
    issues.push({ field: `${field}.source`, message: "must be a redacted stable source label" });
  }
  const requestIdValid = item.requestId === null || (typeof item.requestId === "string" && /^update_[a-z0-9_-]{8,120}$/.test(item.requestId));
  if (!requestIdValid) issues.push({ field: `${field}.requestId`, message: "must be null or a safe update request identifier" });
  const requestHashValid = item.requestHash === null || isSha256(item.requestHash);
  if (!requestHashValid) issues.push({ field: `${field}.requestHash`, message: "must be null or sha256:<64 lowercase hex>" });
  if (item.sourceKind === "request") {
    if (item.requestId === null) issues.push({ field: `${field}.requestId`, message: "request source must include requestId" });
    if (item.requestHash === null) issues.push({ field: `${field}.requestHash`, message: "request source must include requestHash" });
  } else if (item.requestId !== null || item.requestHash !== null) {
    issues.push({ field: field, message: "automatic/operator source must not include request identity" });
  }
}

function validateEventTime(item: Record<string, unknown>, index: number, events: unknown[], issues: UpdaterPhaseJournalIssue[]): void {
  const field = `events[${index}].createdAt`;
  if (typeof item.createdAt !== "string" || !isCanonicalUtcTimestamp(item.createdAt)) {
    issues.push({ field, message: "must be a canonical UTC timestamp" });
    return;
  }
  if (index === 0) return;
  const previous = events[index - 1];
  if (!isRecord(previous) || typeof previous.createdAt !== "string" || !isCanonicalUtcTimestamp(previous.createdAt)) return;
  if (Date.parse(item.createdAt) <= Date.parse(previous.createdAt)) issues.push({ field, message: "must be strictly later than the preceding event" });
}

function validateDoesNotProve(value: unknown, issues: UpdaterPhaseJournalIssue[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push({ field: "doesNotProve", message: "must be an array of strings" });
    return;
  }
  for (const required of requiredDoesNotProve) if (!value.includes(required)) issues.push({ field: "doesNotProve", message: `must include ${required}` });
}

function validateSafety(value: unknown, issues: UpdaterPhaseJournalIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "safetyFacts", message: "must be an object" });
    return;
  }
  const keys = ["readOnly", "networkRequested", "serverCommandAttempted", "migrationAttempted", "productionWriteAttempted", "secretValuePrinted", "residualLedgerUpdated"];
  exactKeys(value, keys, "safetyFacts", issues);
  for (const key of keys) {
    const expected = key === "readOnly";
    if (value[key] !== expected) issues.push({ field: `safetyFacts.${key}`, message: `must be ${String(expected)}` });
  }
}

function rejectSensitiveContent(raw: string, issues: UpdaterPhaseJournalIssue[]): void {
  for (const marker of ["postgresql://", "DATABASE_URL", "COSIGN_PRIVATE_KEY", "/etc/", "/opt/", "/Users/"]) {
    if (raw.includes(marker)) issues.push({ field: "record", message: `must not contain sensitive marker ${marker}` });
  }
}

export function computeUpdaterPhaseEventHash(value: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(stableStringify({ ...value, eventHash: "" })).digest("hex")}`;
}

export function computeUpdaterPhaseJournalHash(value: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(stableStringify({ ...value, journalHash: "" })).digest("hex")}`;
}

function exactKeys(value: Record<string, unknown>, keys: string[], field: string, issues: UpdaterPhaseJournalIssue[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) issues.push({ field, message: `keys must be exactly ${[...keys].sort().join(", ")}` });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isCanonicalUtcTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function readUpdaterPhaseJournal(file: string): UpdaterPhaseJournalIssue[] {
  return validateUpdaterPhaseJournal(readFileSync(file, "utf8"));
}

if (process.argv[1] && process.argv[1].endsWith("updater-phase-journal-validate.ts")) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: pnpm updater:phase-journal:validate <fixture.json>");
    process.exit(2);
  }
  const issues = readUpdaterPhaseJournal(file);
  if (issues.length) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    process.exit(1);
  }
  console.log("updater phase journal fixture validation passed: strict hash-chained phase state machine is valid.");
}
