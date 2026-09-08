import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Web 侧只消费 root-agent 的脱敏、只读 journal 证据；本模块没有写文件、
 * 取得锁或执行命令的能力。任何无法严格验证的证据都会进入 reconciliation。
 */

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const OPERATION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SOURCE_PATTERN = /^[a-z][a-z0-9._:-]{1,79}$/;
const REASON_PATTERN = /^[A-Z0-9_]{2,80}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const controlledOperationJournalPhases = [
  "admission",
  "validation",
  "backup",
  "prepare",
  "migration",
  "switch",
  "health",
  "smoke",
  "rollback",
  "terminal",
  "reconciliation",
] as const;
export type ControlledOperationJournalPhase = typeof controlledOperationJournalPhases[number];
const operationalPhases = [
  "admission",
  "validation",
  "backup",
  "prepare",
  "migration",
  "switch",
  "health",
  "smoke",
  "rollback",
  "terminal",
] as const;

export const controlledOperationJournalLockKinds = [
  "QUEUE_CONTROL",
  "PRODUCTION_STATE",
  "AGENT_LOCAL",
] as const;
export type ControlledOperationJournalLockKind = typeof controlledOperationJournalLockKinds[number];

const phaseStatePairs = new Set([
  "admission:complete",
  "validation:started", "validation:complete",
  "backup:started", "backup:complete",
  "prepare:started", "prepare:complete",
  "migration:started", "migration:complete", "migration:skipped",
  "switch:started", "switch:complete",
  "health:started", "health:complete",
  "smoke:started", "smoke:complete",
  "rollback:started", "rollback:complete", "rollback:needs_reconciliation",
  "terminal:started", "terminal:applied", "terminal:rolled_back", "terminal:rejected", "terminal:needs_reconciliation",
  "reconciliation:reconciliation_required",
]);

const phaseSchema = z.enum(controlledOperationJournalPhases);
const hashSchema = z.string().regex(HASH_PATTERN);
const operationIdSchema = z.string().regex(OPERATION_ID_PATTERN);
const releaseSchema = z.object({
  tag: z.string().regex(/^v\d+\.\d+\.\d+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  manifestSha256: hashSchema,
  webImageDigest: z.string().regex(/^ghcr\.io\/[a-z0-9._/-]+:v\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/),
  migrationImageDigest: z.string().regex(/^ghcr\.io\/[a-z0-9._/-]+:v\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/),
}).strict();

export const controlledOperationJournalEntrySchema = z.object({
  schemaVersion: z.literal(1),
  operationId: operationIdSchema,
  sequence: z.number().int().positive(),
  phase: phaseSchema,
  state: z.string().regex(/^[a-z_]{2,40}$/),
  reasonCode: z.string().regex(REASON_PATTERN),
  uncertainPhase: z.enum(operationalPhases).nullable(),
  sourceKind: z.enum(["automatic", "operator", "request"]),
  source: z.string().regex(SOURCE_PATTERN),
  requestId: z.string().regex(REQUEST_ID_PATTERN).nullable(),
  requestHash: hashSchema.nullable(),
  release: releaseSchema.nullable(),
  executionAttempted: z.literal(false),
  beforeStateHash: hashSchema.nullable(),
  backupSetId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).nullable(),
  backupInventoryHash: hashSchema.nullable(),
  updateRecordHash: hashSchema.nullable(),
  productionIdentityHash: hashSchema.nullable(),
  createdAt: z.string().regex(UTC_TIMESTAMP_PATTERN),
  previousEventHash: hashSchema.nullable(),
  eventHash: hashSchema,
}).strict();

export type ControlledOperationJournalEntry = z.infer<typeof controlledOperationJournalEntrySchema>;

export const controlledOperationJournalLockSchema = z.object({
  schemaVersion: z.literal(1),
  operationId: operationIdSchema,
  lockKind: z.enum(controlledOperationJournalLockKinds),
  owner: z.string().regex(SOURCE_PATTERN),
  acquiredAt: z.string().regex(UTC_TIMESTAMP_PATTERN),
  releasedAt: z.string().regex(UTC_TIMESTAMP_PATTERN).nullable(),
  leaseExpiresAt: z.string().regex(UTC_TIMESTAMP_PATTERN).nullable(),
  generation: z.number().int().positive(),
  lockTokenHash: hashSchema,
  executionAttempted: z.literal(false),
}).strict();

export type ControlledOperationJournalLock = z.infer<typeof controlledOperationJournalLockSchema>;

export const controlledOperationReconciliationReasonCodes = [
  "JOURNAL_EMPTY",
  "JOURNAL_INVALID",
  "JOURNAL_CHAIN_BROKEN",
  "REQUEST_IDENTITY_MISMATCH",
  "LOCK_METADATA_INVALID",
  "LOCK_ORDER_INVALID",
  "ACTIVE_JOURNAL",
  "JOURNAL_RECONCILIATION_REQUIRED",
] as const;
export type ControlledOperationReconciliationReason = typeof controlledOperationReconciliationReasonCodes[number];

export interface ControlledOperationReconciliationRecord {
  schemaVersion: 1;
  operationId: string | null;
  status: "CLEAN" | "NEEDS_RECONCILIATION";
  reasonCode: ControlledOperationReconciliationReason | null;
  uncertainPhase: ControlledOperationJournalPhase | null;
  requestId: string | null;
  requestHash: string | null;
  lastEventHash: string | null;
  executionAttempted: false;
}

export const controlledOperationReconciliationRecordSchema = z.object({
  schemaVersion: z.literal(1),
  operationId: operationIdSchema.nullable(),
  status: z.enum(["CLEAN", "NEEDS_RECONCILIATION"]),
  reasonCode: z.enum(controlledOperationReconciliationReasonCodes).nullable(),
  uncertainPhase: z.enum(operationalPhases).nullable(),
  requestId: z.string().regex(REQUEST_ID_PATTERN).nullable(),
  requestHash: hashSchema.nullable(),
  lastEventHash: hashSchema.nullable(),
  executionAttempted: z.literal(false),
}).strict();

export function parseControlledOperationReconciliationRecord(raw: unknown): ControlledOperationReconciliationRecord | null {
  const parsed = controlledOperationReconciliationRecordSchema.safeParse(raw);
  if (!parsed.success) return null;
  const record = parsed.data;
  if (record.status === "CLEAN" && (record.reasonCode !== null || record.uncertainPhase !== null)) return null;
  if (record.status === "NEEDS_RECONCILIATION" && record.reasonCode === null) return null;
  return record;
}

export function parseControlledOperationJournalEntry(raw: unknown): ControlledOperationJournalEntry | null {
  const parsed = controlledOperationJournalEntrySchema.safeParse(raw);
  if (!parsed.success) return null;
  const item = parsed.data;
  if (!phaseStatePairs.has(`${item.phase}:${item.state}`)) return null;
  if (item.phase !== "reconciliation" && item.uncertainPhase !== null) return null;
  if (item.phase === "reconciliation" && item.state !== "reconciliation_required") return null;
  if (item.sourceKind === "request" && (item.requestId === null || item.requestHash === null)) return null;
  if (item.sourceKind !== "request" && (item.requestId !== null || item.requestHash !== null)) return null;
  if (item.release && item.release.tag !== `v${item.release.version}`) return null;
  if (item.release && (!item.release.webImageDigest.includes(`:${item.release.tag}@sha256:`)
    || !item.release.migrationImageDigest.includes(`:${item.release.tag}@sha256:`))) return null;
  if (!Number.isFinite(Date.parse(item.createdAt))) return null;
  return item;
}

export function parseControlledOperationJournalLock(raw: unknown): ControlledOperationJournalLock | null {
  const parsed = controlledOperationJournalLockSchema.safeParse(raw);
  if (!parsed.success) return null;
  const item = parsed.data;
  const acquired = Date.parse(item.acquiredAt);
  const released = item.releasedAt === null ? null : Date.parse(item.releasedAt);
  const expires = item.leaseExpiresAt === null ? null : Date.parse(item.leaseExpiresAt);
  if (!Number.isFinite(acquired) || (released !== null && !Number.isFinite(released)) || (expires !== null && !Number.isFinite(expires))) return null;
  if (released !== null && released < acquired) return null;
  if (expires !== null && expires <= acquired) return null;
  return item;
}

/** Lock acquisition must be strictly queue-control -> production-state -> agent-local. */
export function isControlledOperationJournalLockOrder(value: readonly ControlledOperationJournalLockKind[]): boolean {
  if (value.length === 0) return false;
  let previous = -1;
  for (const item of value) {
    const index = controlledOperationJournalLockKinds.indexOf(item);
    if (index < 0 || index <= previous) return false;
    previous = index;
  }
  return true;
}

export function computeControlledOperationJournalEntryHash(value: ControlledOperationJournalEntry): string {
  return sha256Canonical({ ...value, eventHash: "" });
}

export function reconcileControlledOperationJournal(input: {
  entries: unknown;
  locks?: unknown;
  expectedRequest?: { requestId: string; requestHash: string };
}): ControlledOperationReconciliationRecord {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  if (entries.length === 0) return reconciliation(null, "JOURNAL_EMPTY", null, null, null);

  const parsed: ControlledOperationJournalEntry[] = [];
  for (const raw of entries) {
    const item = parseControlledOperationJournalEntry(raw);
    if (!item) return reconciliation(operationIdFrom(entries), "JOURNAL_INVALID", null, null, null);
    parsed.push(item);
  }
  const operationId = parsed[0].operationId;
  let previousHash: string | null = null;
  let previousCreatedAt = 0;
  let releaseIdentity: string | null = null;
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (item.operationId !== operationId || item.sequence !== index + 1) return reconciliation(operationId, "JOURNAL_CHAIN_BROKEN", null, requestIdFrom(parsed), requestHashFrom(parsed));
    if (item.previousEventHash !== previousHash || computeControlledOperationJournalEntryHash(item) !== item.eventHash) {
      return reconciliation(operationId, "JOURNAL_CHAIN_BROKEN", null, requestIdFrom(parsed), requestHashFrom(parsed));
    }
    const createdAt = Date.parse(item.createdAt);
    if (createdAt <= previousCreatedAt) return reconciliation(operationId, "JOURNAL_CHAIN_BROKEN", null, requestIdFrom(parsed), requestHashFrom(parsed));
    previousCreatedAt = createdAt;
    previousHash = item.eventHash;
    if (item.release !== null) {
      const encoded = stableStringify(item.release);
      if (releaseIdentity !== null && encoded !== releaseIdentity) return reconciliation(operationId, "JOURNAL_CHAIN_BROKEN", null, requestIdFrom(parsed), requestHashFrom(parsed));
      releaseIdentity = encoded;
    } else if (releaseIdentity !== null && item.phase !== "admission") {
      return reconciliation(operationId, "JOURNAL_CHAIN_BROKEN", null, requestIdFrom(parsed), requestHashFrom(parsed));
    }
  }

  const requestEvents = parsed.filter((item) => item.sourceKind === "request");
  if (requestEvents.length > 1 && requestEvents.some((item) => item.requestId !== requestEvents[0].requestId || item.requestHash !== requestEvents[0].requestHash)) {
    return reconciliation(operationId, "REQUEST_IDENTITY_MISMATCH", null, requestIdFrom(parsed), requestHashFrom(parsed));
  }
  if (input.expectedRequest) {
    if (!REQUEST_ID_PATTERN.test(input.expectedRequest.requestId) || !HASH_PATTERN.test(input.expectedRequest.requestHash)
      || requestEvents.length === 0
      || requestEvents.some((item) => item.requestId !== input.expectedRequest?.requestId || item.requestHash !== input.expectedRequest?.requestHash)) {
      return reconciliation(operationId, "REQUEST_IDENTITY_MISMATCH", null, requestIdFrom(parsed), requestHashFrom(parsed));
    }
  }
  if (input.locks !== undefined) {
    if (!Array.isArray(input.locks) || input.locks.length === 0) return reconciliation(operationId, "LOCK_METADATA_INVALID", null, requestIdFrom(parsed), requestHashFrom(parsed));
    const locks: ControlledOperationJournalLock[] = [];
    for (const raw of input.locks) {
      const lock = parseControlledOperationJournalLock(raw);
      if (!lock || lock.operationId !== operationId) return reconciliation(operationId, "LOCK_METADATA_INVALID", null, requestIdFrom(parsed), requestHashFrom(parsed));
      locks.push(lock);
    }
    if (!isControlledOperationJournalLockOrder(locks.map((item) => item.lockKind))) return reconciliation(operationId, "LOCK_ORDER_INVALID", null, requestIdFrom(parsed), requestHashFrom(parsed));
  }

  const last = parsed[parsed.length - 1];
  if (last.phase === "reconciliation") return reconciliation(operationId, "JOURNAL_RECONCILIATION_REQUIRED", last.uncertainPhase, requestIdFrom(parsed), requestHashFrom(parsed));
  if (last.phase !== "terminal" || !["applied", "rolled_back", "rejected"].includes(last.state)) return reconciliation(operationId, "ACTIVE_JOURNAL", last.phase, requestIdFrom(parsed), requestHashFrom(parsed));
  return {
    schemaVersion: 1,
    operationId,
    status: "CLEAN",
    reasonCode: null,
    uncertainPhase: null,
    requestId: requestIdFrom(parsed),
    requestHash: requestHashFrom(parsed),
    lastEventHash: last.eventHash,
    executionAttempted: false,
  };
}

function reconciliation(operationId: string | null, reasonCode: ControlledOperationReconciliationReason, uncertainPhase: ControlledOperationJournalPhase | null, requestId: string | null, requestHash: string | null): ControlledOperationReconciliationRecord {
  return { schemaVersion: 1, operationId, status: "NEEDS_RECONCILIATION", reasonCode, uncertainPhase, requestId, requestHash, lastEventHash: null, executionAttempted: false };
}

function operationIdFrom(entries: unknown[]): string | null {
  const first = entries[0];
  return typeof first === "object" && first !== null && "operationId" in first && typeof first.operationId === "string" ? first.operationId : null;
}

function requestIdFrom(entries: ControlledOperationJournalEntry[]): string | null {
  return entries.find((item) => item.requestId !== null)?.requestId ?? null;
}

function requestHashFrom(entries: ControlledOperationJournalEntry[]): string | null {
  return entries.find((item) => item.requestHash !== null)?.requestHash ?? null;
}

function sha256Canonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
