import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma, type Prisma } from "@areaforge/db";
import {
  transitionControlledOperationRequest,
  type ControlledOperationRequestCommand,
  type ControlledOperationRequestState,
  type ControlledOperationRequestStatus,
} from "@areaforge/core";
import {
  getControlledOperationDescriptor,
  parseControlledOperationIntent,
  type ControlledOperationIntent,
} from "./controlled-operation";
import type { CurrentUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/responses";
import { requirePlatformOperator } from "./operator-policy";

// Journal/lock/reconciliation contracts are re-exported from the request
// service for the future root-agent adapter.  The Web runtime only validates
// report-only evidence; this module does not append journal entries or acquire
// any production lock.
export {
  computeControlledOperationJournalEntryHash,
  controlledOperationJournalEntrySchema,
  controlledOperationJournalLockSchema,
  controlledOperationJournalLockKinds,
  controlledOperationJournalPhases,
  controlledOperationReconciliationReasonCodes,
  controlledOperationReconciliationRecordSchema,
  isControlledOperationJournalLockOrder,
  parseControlledOperationJournalEntry,
  parseControlledOperationJournalLock,
  parseControlledOperationReconciliationRecord,
  reconcileControlledOperationJournal,
} from "./controlled-operation-journal";
export type {
  ControlledOperationJournalEntry,
  ControlledOperationJournalLock,
  ControlledOperationJournalLockKind,
  ControlledOperationJournalPhase,
  ControlledOperationReconciliationRecord,
} from "./controlled-operation-journal";

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION_REQUEST_DOMAIN = "areaforge.controlled-operation.request.v1";
const OPERATION_INTENT_DOMAIN = "areaforge.controlled-operation.intent.v1";
export const CONTROLLED_OPERATION_READ_TTL_MS = 15 * 60_000;
export const CONTROLLED_OPERATION_MUTATION_TTL_MS = 5 * 60_000;
export const CONTROLLED_OPERATION_MAX_LEASE_MS = 15 * 60_000;

export const controlledOperationRequestBindingSchema = z.object({
  expectedRevision: z.number().int().positive(),
  requestHash: z.string().regex(HASH_PATTERN),
  nonce: z.string().uuid(),
}).strict();

export const controlledOperationHoldSchema = controlledOperationRequestBindingSchema.extend({
  reasonCode: z.enum(["RELEASE", "INCIDENT", "RESTORE", "CAPACITY"]),
}).strict();

export const controlledOperationWorkerLeaseSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
  workerId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,120}$/),
  expectedBeforeHash: z.string().regex(HASH_PATTERN),
  leaseExpiresAt: z.string().datetime({ offset: true }),
}).strict();

export interface ControlledOperationRequestDto {
  id: string;
  operation: ControlledOperationIntent["operation"];
  risk: "READ_ONLY" | "HIGH_RISK";
  requiresApproval: boolean;
  status: ControlledOperationRequestStatus;
  requestedByUserId: string;
  confirmedByUserId: string | null;
  approvedByUserId: string | null;
  requestedReason: string;
  expectedBeforeHash: string;
  idempotencyKey: string;
  intentHash: string;
  requestHash: string;
  nonce: string;
  requestedAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  approvedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  attempt: number;
  workerId: string | null;
  leaseExpiresAt: string | null;
  failureCode: string | null;
  retryable: boolean;
  holdReasonCode: string | null;
  resultCode: string | null;
  evidenceHash: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ControlledOperationWorkerLeaseDto {
  request: ControlledOperationRequestDto;
  leaseToken: string;
}

export interface CreateControlledOperationRequestOptions {
  now?: Date;
  id?: string;
  nonce?: string;
}

export interface ControlledOperationRequestListOptions {
  status?: ControlledOperationRequestStatus;
  limit?: number;
}

export class ControlledOperationRequestError extends ApiError {
  constructor(code: string, status = 409) {
    super(code, status);
  }
}

export async function createControlledOperationRequest(
  actor: CurrentUser,
  rawIntent: unknown,
  options: CreateControlledOperationRequestOptions = {},
): Promise<ControlledOperationRequestDto> {
  const intent = parseControlledOperationIntent(rawIntent);
  if (!intent) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_INTENT_INVALID", 400);
  const descriptor = getControlledOperationDescriptor(intent.operation.operation);
  await requirePlatformOperator(actor, { fresh: descriptor.risk === "HIGH_RISK" });

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_TIME_INVALID", 400);
  const nonce = options.nonce ?? randomUUID();
  if (!UUID_PATTERN.test(nonce)) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_NONCE_INVALID", 400);
  const requestedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlFor(descriptor.risk)).toISOString();
  const id = options.id ?? `opreq_${now.getTime()}_${randomUUID()}`;
  const intentHash = computeControlledOperationIntentHash(actor.id, intent);
  const requestHash = computeControlledOperationRequestHash({
    id,
    actorId: actor.id,
    intent,
    descriptor,
    intentHash,
    nonce,
    requestedAt,
    expiresAt,
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.controlledOperationRequest.findUnique({
        where: { requestedByUserId_idempotencyKey: { requestedByUserId: actor.id, idempotencyKey: intent.idempotencyKey } },
      });
      if (existing) {
        assertRowIntegrity(existing);
        // The idempotency key identifies the semantic intent.  A retry may
        // arrive with a fresh nonce/timestamp, but must return the original
        // immutable request instead of creating a second execution envelope.
        if (existing.intentHash !== intentHash) {
          throw new ControlledOperationRequestError("CONTROLLED_OPERATION_IDEMPOTENCY_CONFLICT", 409);
        }
        return serializeRow(existing);
      }

      const row = await tx.controlledOperationRequest.create({
        data: {
          id,
          operationCode: descriptor.code,
          operation: intent.operation as unknown as Prisma.InputJsonValue,
          risk: descriptor.risk,
          requiresApproval: descriptor.requiresApproval,
          requestedByUserId: actor.id,
          requestedReason: intent.requestedReason,
          expectedBeforeHash: intent.expectedBeforeHash,
          idempotencyKey: intent.idempotencyKey,
          intentHash,
          requestHash,
          nonce,
          status: descriptor.requiresApproval ? "CONFIRMATION_REQUIRED" : "PREVIEWED",
          requestedAt: now,
          expiresAt: new Date(expiresAt),
        },
      });
      await audit(tx, actor.id, "CONTROLLED_OPERATION_REQUEST_CREATED", row.id, {
        operationCode: row.operationCode,
        risk: row.risk,
        requestHash: row.requestHash,
      });
      return serializeRow(row);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (isPrismaConflict(error)) {
      const existing = await prisma.controlledOperationRequest.findUnique({
        where: { requestedByUserId_idempotencyKey: { requestedByUserId: actor.id, idempotencyKey: intent.idempotencyKey } },
      });
      if (existing && existing.intentHash === intentHash) return serializeRow(existing);
      throw new ControlledOperationRequestError("CONTROLLED_OPERATION_IDEMPOTENCY_CONFLICT", 409);
    }
    throw error;
  }
}

export async function listControlledOperationRequests(
  actor: CurrentUser,
  options: ControlledOperationRequestListOptions = {},
): Promise<ControlledOperationRequestDto[]> {
  await requirePlatformOperator(actor);
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = await prisma.controlledOperationRequest.findMany({
    where: options.status ? { status: options.status } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map(serializeRow);
}

export async function getControlledOperationRequest(actor: CurrentUser, requestId: string): Promise<ControlledOperationRequestDto> {
  await requirePlatformOperator(actor);
  const row = await prisma.controlledOperationRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_NOT_FOUND", 404);
  return serializeRow(row);
}

export async function confirmControlledOperationRequest(
  actor: CurrentUser,
  requestId: string,
  binding: z.input<typeof controlledOperationRequestBindingSchema>,
): Promise<ControlledOperationRequestDto> {
  await requirePlatformOperator(actor, { fresh: true });
  const parsed = controlledOperationRequestBindingSchema.safeParse(binding);
  if (!parsed.success) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_BINDING_INVALID", 400);
  return mutateOperatorRequest(actor, requestId, parsed.data, (row, now) => {
    const state = rowToState(row);
    const type = state.status === "PREVIEWED" ? "ACKNOWLEDGE_PREVIEW" : "CONFIRMATION_REQUIRED" === state.status ? "CONFIRM" : null;
    if (!type) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_INVALID_STATUS", 409);
    return { command: { type, now } as ControlledOperationRequestCommand, extra: { confirmedByUserId: actor.id, confirmedAt: new Date(now) } };
  }, "CONTROLLED_OPERATION_REQUEST_CONFIRMED");
}

export async function approveControlledOperationRequest(
  actor: CurrentUser,
  requestId: string,
  binding: z.input<typeof controlledOperationRequestBindingSchema>,
): Promise<ControlledOperationRequestDto> {
  await requirePlatformOperator(actor, { fresh: true });
  const parsed = controlledOperationRequestBindingSchema.safeParse(binding);
  if (!parsed.success) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_BINDING_INVALID", 400);
  return mutateOperatorRequest(actor, requestId, parsed.data, (_row, now) => ({
    command: { type: "APPROVE", now },
    extra: { approvedByUserId: actor.id, approvedAt: new Date(now) },
  }), "CONTROLLED_OPERATION_REQUEST_APPROVED");
}

export async function cancelControlledOperationRequest(actor: CurrentUser, requestId: string, binding: unknown): Promise<ControlledOperationRequestDto> {
  return operatorTransition(actor, requestId, binding, (now) => ({ type: "REQUEST_CANCEL", now }), "CONTROLLED_OPERATION_REQUEST_CANCELLED");
}

export async function holdControlledOperationRequest(actor: CurrentUser, requestId: string, binding: unknown): Promise<ControlledOperationRequestDto> {
  const parsed = controlledOperationHoldSchema.safeParse(binding);
  if (!parsed.success) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_BINDING_INVALID", 400);
  return operatorTransition(actor, requestId, parsed.data, (now) => ({ type: "HOLD", now }), "CONTROLLED_OPERATION_REQUEST_HELD", { holdReasonCode: parsed.data.reasonCode });
}

export async function resumeControlledOperationRequest(actor: CurrentUser, requestId: string, binding: unknown): Promise<ControlledOperationRequestDto> {
  return operatorTransition(actor, requestId, binding, (now) => ({ type: "RESUME", now }), "CONTROLLED_OPERATION_REQUEST_RESUMED", { holdReasonCode: null });
}

export async function retryControlledOperationRequest(actor: CurrentUser, requestId: string, binding: unknown): Promise<ControlledOperationRequestDto> {
  return operatorTransition(actor, requestId, binding, (now) => ({ type: "RETRY", now }), "CONTROLLED_OPERATION_REQUEST_RETRY_QUEUED", { holdReasonCode: null });
}

export async function claimControlledOperationRequest(input: {
  requestId: string;
  workerId: string;
  expectedBeforeHash: string;
  leaseExpiresAt: Date;
  now?: Date;
}): Promise<ControlledOperationWorkerLeaseDto> {
  validateWorkerInput(input);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || input.leaseExpiresAt.getTime() <= now.getTime()) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_LEASE_INVALID", 409);
  if (input.leaseExpiresAt.getTime() - now.getTime() > CONTROLLED_OPERATION_MAX_LEASE_MS) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_LEASE_TOO_LONG", 409);
  const result = await prisma.$transaction(async (tx) => {
    const row = await lockAndLoad(tx, input.requestId);
    assertRowIntegrity(row);
    if (row.expectedBeforeHash !== input.expectedBeforeHash) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_EXPECTED_BEFORE_MISMATCH", 409);
    const result = transitionControlledOperationRequest(rowToState(row), { type: "CLAIM", workerId: input.workerId, now: now.toISOString(), leaseExpiresAt: input.leaseExpiresAt.toISOString() });
    if (result.error === "EXPIRED") {
      const expired = transitionControlledOperationRequest(rowToState(row), { type: "EXPIRE", now: now.toISOString() });
      if (!expired.error) {
        const updated = await updateState(tx, row, expired.state, { finishedAt: now });
        await audit(tx, null, "CONTROLLED_OPERATION_REQUEST_EXPIRED", row.id, {});
        return { request: serializeRow(updated), leaseToken: "", expired: true };
      }
    }
    if (result.error) throw transitionError(result.error);
    const leaseToken = randomUUID();
    const updated = await updateState(tx, row, result.state, {
      workerId: input.workerId,
      leaseToken,
      leaseExpiresAt: input.leaseExpiresAt,
      startedAt: row.startedAt ?? now,
    });
    await audit(tx, null, "CONTROLLED_OPERATION_REQUEST_CLAIMED", row.id, { workerId: input.workerId, attempt: updated.attempt });
    return { request: serializeRow(updated), leaseToken, expired: false };
  }, { isolationLevel: "Serializable" });
  if (result.expired) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_EXPIRED", 409);
  return { request: result.request, leaseToken: result.leaseToken };
}

export async function heartbeatControlledOperationRequest(input: {
  requestId: string;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: Date;
  now?: Date;
}): Promise<ControlledOperationRequestDto> {
  const now = input.now ?? new Date();
  validateWorkerIdentity(input);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(input.leaseExpiresAt.getTime()) || input.leaseExpiresAt <= now) {
    throw new ControlledOperationRequestError("CONTROLLED_OPERATION_LEASE_INVALID", 409);
  }
  if (input.leaseExpiresAt.getTime() - now.getTime() > CONTROLLED_OPERATION_MAX_LEASE_MS) {
    throw new ControlledOperationRequestError("CONTROLLED_OPERATION_LEASE_TOO_LONG", 409);
  }
  return workerTransition(input, { type: "HEARTBEAT", workerId: input.workerId, now: now.toISOString(), leaseExpiresAt: input.leaseExpiresAt.toISOString() });
}

export async function completeControlledOperationRequest(input: {
  requestId: string;
  workerId: string;
  leaseToken: string;
  outcome: "SUCCEEDED" | "FAILED" | "CANCELLED" | "PAUSED";
  resultCode?: string;
  failureCode?: string;
  retryable?: boolean;
  evidenceHash?: string;
  now?: Date;
}): Promise<ControlledOperationRequestDto> {
  const now = input.now ?? new Date();
  validateWorkerIdentity(input);
  if (!Number.isFinite(now.getTime())) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_TIME_INVALID", 400);
  if (input.evidenceHash && !HASH_PATTERN.test(input.evidenceHash)) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_EVIDENCE_HASH_INVALID", 400);
  if (input.resultCode && !/^[A-Z0-9_.:-]{1,80}$/.test(input.resultCode)) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_RESULT_INVALID", 400);
  if (input.failureCode && !/^[A-Z0-9_.:-]{1,80}$/.test(input.failureCode)) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_FAILURE_INVALID", 400);
  const command: ControlledOperationRequestCommand = input.outcome === "SUCCEEDED"
    ? { type: "SUCCEED", workerId: input.workerId, now: now.toISOString() }
    : input.outcome === "FAILED"
      ? { type: "FAIL", workerId: input.workerId, now: now.toISOString(), failureCode: input.failureCode ?? "WORKER_FAILED", retryable: input.retryable === true }
      : input.outcome === "CANCELLED"
        ? { type: "CANCEL", workerId: input.workerId, now: now.toISOString() }
        : { type: "PAUSE", workerId: input.workerId, now: now.toISOString() };
  return workerTransition(input, command, {
    ...(input.outcome === "SUCCEEDED" || input.outcome === "FAILED" || input.outcome === "CANCELLED" ? { finishedAt: now } : {}),
    ...(input.outcome === "SUCCEEDED" || input.outcome === "FAILED" || input.outcome === "CANCELLED" ? { resultCode: input.resultCode ?? null, evidenceHash: input.evidenceHash ?? null } : {}),
  });
}

export async function expireControlledOperationRequest(requestId: string, now = new Date()): Promise<ControlledOperationRequestDto> {
  return prisma.$transaction(async (tx) => {
    const row = await lockAndLoad(tx, requestId);
    assertRowIntegrity(row);
    const result = transitionControlledOperationRequest(rowToState(row), { type: "EXPIRE", now: now.toISOString() });
    if (result.error) throw transitionError(result.error);
    const updated = await updateState(tx, row, result.state, { finishedAt: now });
    await audit(tx, null, "CONTROLLED_OPERATION_REQUEST_EXPIRED", row.id, {});
    return serializeRow(updated);
  }, { isolationLevel: "Serializable" });
}

function operatorTransition(
  actor: CurrentUser,
  requestId: string,
  binding: unknown,
  command: (now: string) => ControlledOperationRequestCommand,
  auditAction: string,
  extra: Record<string, unknown> = {},
): Promise<ControlledOperationRequestDto> {
  return (async () => {
    await requirePlatformOperator(actor, { fresh: true });
    const parsed = controlledOperationRequestBindingSchema.safeParse(binding);
    if (!parsed.success) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_BINDING_INVALID", 400);
    return mutateOperatorRequest(actor, requestId, parsed.data, (_row, now) => ({ command: command(now), extra }), auditAction);
  })();
}

async function mutateOperatorRequest(
  actor: CurrentUser,
  requestId: string,
  binding: z.infer<typeof controlledOperationRequestBindingSchema>,
  commandFactory: (row: RequestRow, now: string) => { command: ControlledOperationRequestCommand; extra: Record<string, unknown> },
  auditAction: string,
): Promise<ControlledOperationRequestDto> {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const row = await lockAndLoad(tx, requestId);
    assertRowIntegrity(row);
    assertBinding(row, binding);
    const nowIso = now.toISOString();
    const built = commandFactory(row, nowIso);
    const result = transitionControlledOperationRequest(rowToState(row), built.command);
    if (result.error === "EXPIRED") {
      const expired = transitionControlledOperationRequest(rowToState(row), { type: "EXPIRE", now: nowIso });
      if (!expired.error) {
        const updated = await updateState(tx, row, expired.state, { finishedAt: now });
        await audit(tx, null, "CONTROLLED_OPERATION_REQUEST_EXPIRED", row.id, {});
        return { dto: serializeRow(updated), expired: true };
      }
    }
    if (result.error) throw transitionError(result.error);
    const updated = await updateState(tx, row, result.state, {
      ...built.extra,
      ...(isTerminalStatus(result.state.status) ? { finishedAt: now } : {}),
    });
    await audit(tx, actor.id, auditAction, row.id, { revision: updated.revision, requestHash: row.requestHash });
    return { dto: serializeRow(updated), expired: false };
  }, { isolationLevel: "Serializable" });
  if (result.expired) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_EXPIRED", 409);
  return result.dto;
}

async function workerTransition(
  input: { requestId: string; workerId: string; leaseToken: string },
  command: ControlledOperationRequestCommand,
  extra: Record<string, unknown> = {},
): Promise<ControlledOperationRequestDto> {
  const result = await prisma.$transaction(async (tx) => {
    const row = await lockAndLoad(tx, input.requestId);
    assertRowIntegrity(row);
    if (row.workerId !== input.workerId || row.leaseToken !== input.leaseToken) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_LEASE_OWNER_MISMATCH", 409);
    const result = transitionControlledOperationRequest(rowToState(row), command);
    if (result.error === "EXPIRED") {
      const expired = transitionControlledOperationRequest(rowToState(row), { type: "EXPIRE", now: command.now });
      if (!expired.error) {
        const updated = await updateState(tx, row, expired.state, { finishedAt: new Date(command.now) });
        await audit(tx, null, "CONTROLLED_OPERATION_REQUEST_EXPIRED", row.id, {});
        return { dto: serializeRow(updated), expired: true };
      }
    }
    if (result.error) throw transitionError(result.error);
    const updated = await updateState(tx, row, result.state, {
      ...extra,
      ...(result.state.status !== "RUNNING" ? { leaseToken: null } : {}),
    });
    await audit(tx, null, `CONTROLLED_OPERATION_REQUEST_${command.type}`, row.id, { workerId: input.workerId, revision: updated.revision });
    return { dto: serializeRow(updated), expired: false };
  }, { isolationLevel: "Serializable" });
  if (result.expired) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_EXPIRED", 409);
  return result.dto;
}

type RequestRow = Awaited<ReturnType<typeof prisma.controlledOperationRequest.findUniqueOrThrow>>;

async function lockAndLoad(tx: Prisma.TransactionClient, requestId: string): Promise<RequestRow> {
  await tx.$queryRaw`SELECT "id" FROM "ControlledOperationRequest" WHERE "id" = ${requestId} FOR UPDATE`;
  const row = await tx.controlledOperationRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_NOT_FOUND", 404);
  return row;
}

async function updateState(
  tx: Prisma.TransactionClient,
  row: RequestRow,
  state: ControlledOperationRequestState,
  extra: Record<string, unknown>,
): Promise<RequestRow> {
  const changed = await tx.controlledOperationRequest.updateMany({
    where: { id: row.id, revision: row.revision },
    data: {
      status: state.status,
      attempt: state.attempt,
      workerId: state.workerId,
      leaseExpiresAt: state.leaseExpiresAt ? new Date(state.leaseExpiresAt) : null,
      failureCode: state.failureCode,
      retryable: state.retryable,
      leaseToken: state.status === "RUNNING" || state.status === "CANCEL_REQUESTED" ? row.leaseToken : null,
      revision: { increment: 1 },
      ...extra,
    },
  });
  if (changed.count !== 1) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_REVISION_CONFLICT", 409);
  return tx.controlledOperationRequest.findUniqueOrThrow({ where: { id: row.id } });
}

function rowToState(row: RequestRow): ControlledOperationRequestState {
  return {
    risk: row.risk,
    requiresApproval: row.requiresApproval,
    status: row.status,
    requestHash: row.requestHash,
    expectedBeforeHash: row.expectedBeforeHash,
    idempotencyKey: row.idempotencyKey,
    expiresAt: row.expiresAt.toISOString(),
    attempt: row.attempt,
    workerId: row.workerId,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    failureCode: row.failureCode,
    retryable: row.retryable,
  };
}

function serializeRow(row: RequestRow): ControlledOperationRequestDto {
  assertRowIntegrity(row);
  const parsed = parseControlledOperationIntent({
    operation: row.operation,
    expectedBeforeHash: row.expectedBeforeHash,
    idempotencyKey: row.idempotencyKey,
    requestedReason: row.requestedReason,
  });
  if (!parsed) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_REQUEST_INTEGRITY_MISMATCH", 409);
  return {
    id: row.id,
    operation: parsed.operation,
    risk: row.risk,
    requiresApproval: row.requiresApproval,
    status: row.status,
    requestedByUserId: row.requestedByUserId,
    confirmedByUserId: row.confirmedByUserId,
    approvedByUserId: row.approvedByUserId,
    requestedReason: row.requestedReason,
    expectedBeforeHash: row.expectedBeforeHash,
    idempotencyKey: row.idempotencyKey,
    intentHash: row.intentHash,
    requestHash: row.requestHash,
    nonce: row.nonce,
    requestedAt: row.requestedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    attempt: row.attempt,
    workerId: row.workerId,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    failureCode: row.failureCode,
    retryable: row.retryable,
    holdReasonCode: row.holdReasonCode,
    resultCode: row.resultCode,
    evidenceHash: row.evidenceHash,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertRowIntegrity(row: RequestRow): void {
  const intent = parseControlledOperationIntent({ operation: row.operation, expectedBeforeHash: row.expectedBeforeHash, idempotencyKey: row.idempotencyKey, requestedReason: row.requestedReason });
  if (!intent) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_REQUEST_INTEGRITY_MISMATCH", 409);
  const descriptor = getControlledOperationDescriptor(intent.operation.operation);
  const requestedAtMs = row.requestedAt.getTime();
  const expiresAtMs = row.expiresAt.getTime();
  const expected = computeControlledOperationRequestHash({
    id: row.id,
    actorId: row.requestedByUserId,
    intent,
    descriptor,
    intentHash: row.intentHash,
    nonce: row.nonce,
    requestedAt: row.requestedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  });
  if (!UUID_PATTERN.test(row.nonce)
    || !Number.isFinite(requestedAtMs)
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs - requestedAtMs !== ttlFor(descriptor.risk)
    || row.operationCode !== descriptor.code
    || row.risk !== descriptor.risk
    || row.requiresApproval !== descriptor.requiresApproval
    || row.requestHash !== expected
    || row.intentHash !== computeControlledOperationIntentHash(row.requestedByUserId, intent)) {
    throw new ControlledOperationRequestError("CONTROLLED_OPERATION_REQUEST_INTEGRITY_MISMATCH", 409);
  }
}

function assertBinding(row: RequestRow, binding: z.infer<typeof controlledOperationRequestBindingSchema>): void {
  if (row.revision !== binding.expectedRevision || row.requestHash !== binding.requestHash || row.nonce !== binding.nonce) {
    throw new ControlledOperationRequestError("CONTROLLED_OPERATION_BINDING_MISMATCH", 409);
  }
}

function validateWorkerInput(input: { workerId: string; expectedBeforeHash: string; leaseExpiresAt: Date }): void {
  if (!("requestId" in input) || typeof input.requestId !== "string" || input.requestId.length < 1 || input.requestId.length > 128) {
    throw new ControlledOperationRequestError("CONTROLLED_OPERATION_REQUEST_ID_INVALID", 400);
  }
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(input.workerId)) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_WORKER_INVALID", 400);
  if (!HASH_PATTERN.test(input.expectedBeforeHash)) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_EXPECTED_BEFORE_INVALID", 400);
  if (!Number.isFinite(input.leaseExpiresAt.getTime())) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_LEASE_INVALID", 400);
}

function validateWorkerIdentity(input: { requestId: string; workerId: string; leaseToken: string }): void {
  if (input.requestId.length < 1 || input.requestId.length > 128) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_REQUEST_ID_INVALID", 400);
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(input.workerId)) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_WORKER_INVALID", 400);
  if (!UUID_PATTERN.test(input.leaseToken)) throw new ControlledOperationRequestError("CONTROLLED_OPERATION_LEASE_TOKEN_INVALID", 400);
}

function isTerminalStatus(status: ControlledOperationRequestStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED" || status === "EXPIRED";
}

function transitionError(error: string): ControlledOperationRequestError {
  const map: Record<string, string> = {
    INVALID_STATUS: "CONTROLLED_OPERATION_INVALID_STATUS",
    EXPIRED: "CONTROLLED_OPERATION_EXPIRED",
    NOT_EXPIRED: "CONTROLLED_OPERATION_NOT_EXPIRED",
    LEASE_REQUIRED: "CONTROLLED_OPERATION_LEASE_REQUIRED",
    LEASE_OWNER_MISMATCH: "CONTROLLED_OPERATION_LEASE_OWNER_MISMATCH",
    LEASE_EXPIRED: "CONTROLLED_OPERATION_LEASE_EXPIRED",
    APPROVAL_REQUIRED: "CONTROLLED_OPERATION_APPROVAL_REQUIRED",
    RETRY_NOT_ALLOWED: "CONTROLLED_OPERATION_RETRY_NOT_ALLOWED",
  };
  return new ControlledOperationRequestError(map[error] ?? "CONTROLLED_OPERATION_TRANSITION_REJECTED", 409);
}

function ttlFor(risk: "READ_ONLY" | "HIGH_RISK"): number {
  return risk === "READ_ONLY" ? CONTROLLED_OPERATION_READ_TTL_MS : CONTROLLED_OPERATION_MUTATION_TTL_MS;
}

export function computeControlledOperationIntentHash(actorId: string, intent: ControlledOperationIntent): string {
  return sha256Canonical({ domain: OPERATION_INTENT_DOMAIN, actorId, operation: intent.operation, expectedBeforeHash: intent.expectedBeforeHash, idempotencyKey: intent.idempotencyKey, requestedReason: intent.requestedReason });
}

export function computeControlledOperationRequestHash(input: {
  id: string;
  actorId: string;
  intent: ControlledOperationIntent;
  descriptor: ReturnType<typeof getControlledOperationDescriptor>;
  intentHash: string;
  nonce: string;
  requestedAt: string;
  expiresAt: string;
}): string {
  return sha256Canonical({
    domain: OPERATION_REQUEST_DOMAIN,
    id: input.id,
    actorId: input.actorId,
    operation: input.intent.operation,
    operationCode: input.descriptor.code,
    risk: input.descriptor.risk,
    requiresApproval: input.descriptor.requiresApproval,
    requestedReason: input.intent.requestedReason,
    expectedBeforeHash: input.intent.expectedBeforeHash,
    idempotencyKey: input.intent.idempotencyKey,
    intentHash: input.intentHash,
    nonce: input.nonce,
    requestedAt: input.requestedAt,
    expiresAt: input.expiresAt,
  });
}

function sha256Canonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  throw new TypeError("unsupported canonical value");
}

function isPrismaConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && ((error as { code?: unknown }).code === "P2002" || (error as { code?: unknown }).code === "P2034");
}

function audit(tx: Prisma.TransactionClient, actorId: string | null, action: string, entityId: string, metadata: Record<string, unknown>): Promise<unknown> {
  return tx.auditEvent.create({ data: { actorId, action, entityType: "ControlledOperationRequest", entityId, metadata: metadata as Prisma.InputJsonValue } });
}
