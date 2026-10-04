import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import {
  boundOperationRequestHash, operationCanonical, operationExpectedBeforeHash, operationIntentHash, operationHash,
  operationRequestHash, operationUpdateWireId, parseBoundOperation, type BoundOperation, type OperationExecutionContext,
} from "./controlled-operation-protocol";

type OperationRow = Prisma.ControlledOperationRequestGetPayload<object>;
export type OperationClaim = { request: OperationRow; operation: BoundOperation; workerId: string; token: string; generation: number };
type RecoveryReceipt = { eventHash: string; generation: number; leaseTokenHash: string };
type ExecutorInput = { requestId: string; workerId: string; operatorEmail: string; scopeId: string; environment: "local_fixture" | "production"; leaseMs?: number; recoveryReceipt?: RecoveryReceipt };

export function verifyBoundOperationRow(row: OperationRow): BoundOperation {
  const bound = parseBoundOperation(row.operation);
  if (!bound) fail("LEGACY_OR_INVALID_BINDING");
  const risk = ["APPLY_RELEASE", "ROLLBACK_RELEASE", "MAINTENANCE_HOLD"].includes(bound.parameters.operation) ? "HIGH_RISK" : "READ_ONLY";
  const intent = { operation: bound.parameters, expectedBeforeHash: row.expectedBeforeHash, idempotencyKey: row.idempotencyKey,
    requestedReason: row.requestedReason, executionSnapshotHash: bound.execution.context.snapshotHash };
  const descriptor = { code: bound.parameters.operation, risk: risk as "HIGH_RISK" | "READ_ONLY", requiresApproval: risk === "HIGH_RISK" };
  const expected = operationRequestHash({ id: row.id, actorId: row.requestedByUserId, intent, descriptor, intentHash: row.intentHash,
    nonce: row.nonce, requestedAt: row.requestedAt.toISOString(), expiresAt: row.expiresAt.toISOString() });
  if (row.operationCode !== descriptor.code || row.risk !== risk || row.requiresApproval !== descriptor.requiresApproval
    || row.intentHash !== operationIntentHash(row.requestedByUserId, intent) || expected !== bound.execution.originalRequestHash
    || row.requestHash !== boundOperationRequestHash(bound) || row.nonce !== bound.execution.nonce
    || row.expectedBeforeHash !== operationExpectedBeforeHash(bound.execution.context.expectedBefore)
    || row.expiresAt.getTime() - row.requestedAt.getTime() !== (risk === "HIGH_RISK" ? 300_000 : 900_000)) fail("INTEGRITY_MISMATCH");
  const wire = bound.execution.updaterRequest;
  if (wire && (wire.id !== operationUpdateWireId(row.requestedAt.toISOString(), row.nonce) || wire.requestedAt !== row.requestedAt.toISOString() || wire.expiresAt !== row.expiresAt.toISOString()
    || wire.idempotencyKey !== row.idempotencyKey)) fail("WIRE_IDENTITY_MISMATCH");
  return bound;
}

export async function readRootOperation(client: PrismaClient, requestId: string): Promise<{ row: OperationRow; operation: BoundOperation }> {
  const row = await client.controlledOperationRequest.findUnique({ where: { id: requestId } });
  if (!row) fail("NOT_FOUND");
  return { row, operation: verifyBoundOperationRow(row) };
}

export async function registerRootOperation(client: PrismaClient, requestId: string, rootScopeHash: string): Promise<void> {
  await operationTransaction(client, async tx => {
    const row = await locked(tx, requestId); verifyBoundOperationRow(row);
    const existing = await tx.auditEvent.findFirst({ where: { action: "CONTROLLED_OPERATION_ROOT_REGISTERED", entityType: "ControlledOperationRequest", entityId: requestId } });
    const metadata = { rootScopeHash, requestHash: row.requestHash, nonce: row.nonce };
    if (existing) {
      if (operationCanonical(existing.metadata) !== operationCanonical(metadata)) fail("ROOT_SCOPE_MISMATCH");
      return;
    }
    await tx.auditEvent.create({ data: { action: "CONTROLLED_OPERATION_ROOT_REGISTERED", entityType: "ControlledOperationRequest", entityId: requestId, metadata } });
  });
}
export async function listRootOperationRegistrations(client: PrismaClient, rootScopeHash: string) {
  const records = await client.auditEvent.findMany({ where: { action: "CONTROLLED_OPERATION_ROOT_REGISTERED", entityType: "ControlledOperationRequest",
    metadata: { path: ["rootScopeHash"], equals: rootScopeHash } } });
  return records.map(record => {
    const metadata = record.metadata as { requestHash?: unknown; nonce?: unknown } | null;
    if (typeof metadata?.requestHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(metadata.requestHash)
      || typeof metadata.nonce !== "string" || !record.entityId) fail("ROOT_REGISTRY_INVALID");
    return { requestId: record.entityId, requestHash: metadata.requestHash, nonce: metadata.nonce };
  });
}
export async function expireRootOperation(client: PrismaClient, requestId: string): Promise<boolean> {
  return operationTransaction(client, async tx => {
    const row = await locked(tx, requestId); verifyBoundOperationRow(row);
    if (row.expiresAt > new Date() || row.workerId !== null || row.leaseToken !== null || ["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"].includes(row.status)) return false;
    await tx.controlledOperationRequest.update({ where: { id: row.id, revision: row.revision }, data: {
      status: "EXPIRED", finishedAt: new Date(), resultCode: "REQUEST_EXPIRED", retryable: false, revision: { increment: 1 },
    } });
    await tx.auditEvent.create({ data: { action: "CONTROLLED_OPERATION_ROOT_EXPIRED", entityType: "ControlledOperationRequest", entityId: row.id,
      metadata: { requestHash: row.requestHash, executionAttempted: false } } });
    return true;
  });
}

export async function claimRootOperation(client: PrismaClient, input: ExecutorInput, recovery = false): Promise<OperationClaim> {
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(input.workerId)) fail("WORKER_INVALID");
  const leaseMs = input.leaseMs ?? 30_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 900_000) fail("LEASE_INVALID");
  return operationTransaction(client, async tx => {
    const row = await locked(tx, input.requestId); const operation = verifyBoundOperationRow(row);
    if (operation.execution.context.scopeId !== input.scopeId || operation.execution.context.environment !== input.environment) fail("SCOPE_MISMATCH");
    const now = new Date();
    if (recovery) {
      if (!["RUNNING", "HELD", "CANCEL_REQUESTED"].includes(row.status) || !row.workerId || !row.leaseExpiresAt || row.leaseExpiresAt > now) fail("RECOVERY_NOT_READY");
    } else {
      if (row.status !== "QUEUED" || row.expiresAt <= now || row.requestedAt.getTime() > now.getTime() + 30_000) fail("ADMISSION_REJECTED");
      await assertOperationAuthority(tx, row, input.operatorEmail);
    }
    const token = randomUUID();
    const status = recovery && row.status !== "RUNNING" ? row.status : "RUNNING";
    const request = await tx.controlledOperationRequest.update({ where: { id: row.id, revision: row.revision }, data: {
      status, workerId: input.workerId, leaseToken: token, leaseExpiresAt: new Date(now.getTime() + leaseMs),
      attempt: { increment: 1 }, revision: { increment: 1 }, startedAt: row.startedAt ?? now,
    } });
    await tx.auditEvent.create({ data: { action: recovery ? "CONTROLLED_OPERATION_ROOT_RECOVERED" : "CONTROLLED_OPERATION_ROOT_CLAIMED",
      entityType: "ControlledOperationRequest", entityId: row.id, metadata: { requestHash: row.requestHash, generation: request.attempt, environment: input.environment,
        leaseProofHash: operationHash(token), recoveryReceipt: input.recoveryReceipt ? { ...input.recoveryReceipt } : null } } });
    return { request, operation, workerId: input.workerId, token, generation: request.attempt };
  });
}

/** claim 与回执来源在同一事务持久化，重复崩溃也不会丢失“只补写回执”的链路。 */
export async function canRecoverRootReceipt(client: PrismaClient, row: OperationRow, receipt: RecoveryReceipt): Promise<boolean> {
  if (receipt.generation === row.attempt && receipt.leaseTokenHash === operationHash(row.leaseToken)) return true;
  const audit = await client.auditEvent.findFirst({ where: { action: "CONTROLLED_OPERATION_ROOT_RECOVERED", entityType: "ControlledOperationRequest", entityId: row.id,
    metadata: { path: ["generation"], equals: row.attempt } }, orderBy: { createdAt: "desc" } });
  const metadata = audit?.metadata as Record<string, unknown> | undefined;
  return metadata?.requestHash === row.requestHash && metadata.leaseProofHash === operationHash(row.leaseToken)
    && operationCanonical(metadata.recoveryReceipt) === operationCanonical(receipt);
}

export async function heartbeatRootOperation(client: PrismaClient, claim: OperationClaim, operatorEmail: string, leaseMs = 30_000) {
  return operationTransaction(client, async tx => {
    const row = await locked(tx, claim.request.id); assertLease(row, claim);
    let authorized = true;
    try { await assertOperationAuthority(tx, row, operatorEmail); } catch { authorized = false; }
    const status = row.expiresAt <= new Date() || !authorized ? "CANCEL_REQUESTED" : row.status;
    await tx.controlledOperationRequest.update({ where: { id: row.id, revision: row.revision }, data: {
      status, leaseExpiresAt: new Date(Date.now() + leaseMs),
      // 心跳不是新的操作决定，不能让页面上的控制绑定每秒失效。
      ...(status !== row.status ? { revision: { increment: 1 } } : {}),
      ...(!authorized ? { failureCode: "OPERATOR_AUTHORITY_CHANGED" } : {}),
    } });
    return { status, authorized, holdReasonCode: row.holdReasonCode };
  });
}

export async function assertRootExecutionAllowed(client: PrismaClient, claim: OperationClaim, input: {
  operatorEmail: string; liveContext: OperationExecutionContext;
}): Promise<void> {
  const { row } = await readRootOperation(client, claim.request.id); assertLease(row, claim);
  if (row.status !== "RUNNING" || row.expiresAt <= new Date()) fail("CONTROL_PENDING");
  await assertOperationAuthority(client, row, input.operatorEmail);
  const expected = claim.operation.execution.context;
  if (expected.scopeId !== input.liveContext.scopeId || expected.environment !== input.liveContext.environment
    || operationCanonical(expected.expectedBefore) !== operationCanonical(input.liveContext.expectedBefore)
    || operationCanonical(expected.target) !== operationCanonical(input.liveContext.target)) fail("EXPECTED_BEFORE_CHANGED");
}

export async function projectRootOperationEvent(client: PrismaClient, claim: OperationClaim, event: {
  rawEventHash: string; projectionHash: string; phase: string; state: string; executionAttempted: boolean; environment: string;
}) {
  return operationTransaction(client, async tx => {
    const row = await locked(tx, claim.request.id); assertLease(row, claim);
    const existing = await tx.auditEvent.findFirst({ where: { entityType: "ControlledOperationRequest", entityId: row.id,
      action: "CONTROLLED_OPERATION_ROOT_PHASE", metadata: { path: ["projectionHash"], equals: event.projectionHash } } });
    if (existing) return;
    await tx.auditEvent.create({ data: { entityType: "ControlledOperationRequest", entityId: row.id,
      action: "CONTROLLED_OPERATION_ROOT_PHASE", metadata: { ...event, requestHash: row.requestHash, generation: claim.generation } } });
    await tx.controlledOperationRequest.update({ where: { id: row.id, revision: row.revision }, data: {
      resultCode: `PHASE_${event.phase.toUpperCase()}_${event.state.toUpperCase()}`, evidenceHash: event.projectionHash, revision: { increment: 1 },
    } });
  });
}

export async function settleRootOperation(client: PrismaClient, claim: OperationClaim, result: {
  outcome: "SUCCEEDED" | "FAILED" | "HELD" | "CANCELLED"; resultCode: string; evidenceHash: string; rawEvidenceHash: string; retryable?: boolean;
}) {
  if (!/^sha256:[a-f0-9]{64}$/.test(result.evidenceHash) || !/^sha256:[a-f0-9]{64}$/.test(result.rawEvidenceHash)
    || !/^[A-Z0-9_]{1,80}$/.test(result.resultCode)) fail("RESULT_INVALID");
  return operationTransaction(client, async tx => {
    const row = await locked(tx, claim.request.id); assertLease(row, claim);
    if ((result.outcome === "HELD" && row.status !== "HELD") || (result.outcome === "CANCELLED" && row.status !== "CANCEL_REQUESTED")) fail("CONTROL_CHANGED");
    const request = await tx.controlledOperationRequest.update({ where: { id: row.id, revision: row.revision }, data: {
      status: result.outcome, resultCode: result.resultCode, evidenceHash: result.evidenceHash,
      failureCode: result.outcome === "FAILED" ? result.resultCode : null, retryable: result.outcome === "FAILED" && result.retryable === true,
      workerId: null, leaseToken: null, leaseExpiresAt: null, revision: { increment: 1 },
      finishedAt: result.outcome === "HELD" ? null : new Date(),
    } });
    await tx.auditEvent.create({ data: { action: "CONTROLLED_OPERATION_ROOT_RESULT", entityType: "ControlledOperationRequest", entityId: row.id,
      metadata: { ...result, requestHash: row.requestHash, generation: claim.generation, environment: claim.operation.execution.context.environment } } });
    return request;
  });
}

async function assertOperationAuthority(client: Prisma.TransactionClient, row: OperationRow, operatorEmail: string): Promise<void> {
  if (!operatorEmail || !row.confirmedByUserId || !row.confirmedAt || (row.requiresApproval && (!row.approvedByUserId || !row.approvedAt))) fail("APPROVAL_MISSING");
  const ids = [...new Set([row.requestedByUserId, row.confirmedByUserId, ...(row.requiresApproval ? [row.approvedByUserId!] : [])])];
  const actors = await client.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, status: true } });
  if (actors.length !== ids.length || actors.some(actor => actor.status !== "ACTIVE" || actor.email.toLowerCase() !== operatorEmail.trim().toLowerCase())) fail("OPERATOR_AUTHORITY_CHANGED");
}
async function locked(tx: Prisma.TransactionClient, requestId: string): Promise<OperationRow> {
  await tx.$queryRaw`SELECT "id" FROM "ControlledOperationRequest" WHERE "id" = ${requestId} FOR UPDATE`;
  const row = await tx.controlledOperationRequest.findUnique({ where: { id: requestId } });
  if (!row) fail("NOT_FOUND");
  return row;
}
function assertLease(row: OperationRow, claim: OperationClaim): void {
  if (row.requestHash !== claim.request.requestHash || row.nonce !== claim.request.nonce || row.leaseToken !== claim.token
    || row.workerId !== claim.workerId || row.attempt !== claim.generation || !row.leaseExpiresAt || row.leaseExpiresAt <= new Date()
    || !["RUNNING", "HELD", "CANCEL_REQUESTED"].includes(row.status)) fail("STALE_EXECUTOR");
}
function fail(code: string): never { throw new Error(`CONTROLLED_OPERATION_${code}`); }

async function operationTransaction<T>(client: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await client.$transaction(work, { isolationLevel: "Serializable" }); }
    catch (error) {
      const value = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
      const sqlState = value.meta?.code ?? value.meta?.driverAdapterError?.cause?.originalCode;
      // 仅重试数据库已回滚的事务；外部副作用不在本函数内，也绝不重试。
      if (attempt >= 4 || !(value.code === "P2034" || sqlState === "40001" || sqlState === "40P01")) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
