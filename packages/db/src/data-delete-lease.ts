import { DataDeleteError, deleteIdentifier, planDataJobFailure } from "@areaforge/core";
import { type PrismaClient, type Prisma, type DataDeletionIntent } from "../generated/prisma/client";
import { deleteClock, requireDataDeleteEnabled, DELETE_FENCE_LOCK } from "./data-delete-intents";

export interface DataDeleteLease { intentId: string; workerId: string; version: number }
export const DATA_DELETE_LEASE_MS = 60_000;

export async function claimDatabaseDeletion(client: PrismaClient, workerId: string, intentId?: string): Promise<DataDeleteLease | null> {
  requireDataDeleteEnabled(); deleteIdentifier(workerId); if (intentId) deleteIdentifier(intentId);
  return client.$transaction(async tx => {
    const now = await deleteClock(tx);
    const stale = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "DataDeletionIntent" WHERE state='RUNNING'
      AND "leaseExpiresAt"<=${now} ORDER BY "leaseExpiresAt" LIMIT 20 FOR UPDATE SKIP LOCKED`;
    for (const { id } of stale) {
      const row = await tx.dataDeletionIntent.findUniqueOrThrow({ where: { id } });
      await tx.dataDeletionIntent.update({ where: { id }, data: { state: row.attempt >= row.maxAttempts ? "FAILED" : "RETRY_WAIT",
        errorCode: "DATA_DELETE_WORKER_LOST", leaseOwner: null, leaseExpiresAt: null, executionPid: null, nextAttemptAt: now, revision: { increment: 1 } } });
    }
    const [candidate] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "DataDeletionIntent"
      WHERE state IN ('COOLDOWN','TRASHED','RETRY_WAIT') AND "availableAt"<=${now}
      AND ("nextAttemptAt" IS NULL OR "nextAttemptAt"<=${now}) AND attempt<"maxAttempts"
      AND (${intentId ?? null}::text IS NULL OR id=${intentId ?? null})
      ORDER BY "availableAt",id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!candidate) return null;
    const row = await tx.dataDeletionIntent.update({ where: { id: candidate.id }, data: { state: "RUNNING", leaseOwner: workerId,
      leaseVersion: { increment: 1 }, leaseExpiresAt: new Date(now.getTime() + DATA_DELETE_LEASE_MS), attempt: { increment: 1 },
      revision: { increment: 1 }, nextAttemptAt: null, errorCode: null } });
    return { intentId: row.id, workerId, version: row.leaseVersion };
  });
}

export async function lockedDeleteLease(tx: Prisma.TransactionClient, lease: DataDeleteLease): Promise<DataDeletionIntent> {
  deleteIdentifier(lease.intentId); deleteIdentifier(lease.workerId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${DELETE_FENCE_LOCK})`;
  await tx.$queryRaw`SELECT id FROM "DataDeletionIntent" WHERE id=${lease.intentId} FOR UPDATE`;
  const row = await tx.dataDeletionIntent.findUnique({ where: { id: lease.intentId } });
  assertDeleteLease(row, lease, await deleteClock(tx));
  return row!;
}

export function assertDeleteLease(row: DataDeletionIntent | null, lease: DataDeleteLease, now: Date): asserts row is DataDeletionIntent {
  if (!row || row.state !== "RUNNING" || row.leaseOwner !== lease.workerId || row.leaseVersion !== lease.version
    || !row.leaseExpiresAt || row.leaseExpiresAt <= now) throw new DataDeleteError("DATA_DELETE_LEASE_LOST");
}

export async function renewDeleteLease(tx: Prisma.TransactionClient, row: DataDeletionIntent) {
  const now = await deleteClock(tx);
  const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
  if (!backend) throw new DataDeleteError("DATA_DELETE_DATABASE_UNAVAILABLE", true);
  return tx.dataDeletionIntent.update({ where: { id: row.id }, data: {
    leaseExpiresAt: new Date(now.getTime() + DATA_DELETE_LEASE_MS), executionPid: backend.pid } });
}

export async function failDatabaseDeletion(client: PrismaClient, lease: DataDeleteLease, error: unknown): Promise<"FAILED" | "RETRY_WAIT" | "LEASE_LOST"> {
  try {
    return await client.$transaction(async tx => {
      const row = await lockedDeleteLease(tx, lease);
      const now = await deleteClock(tx);
      const code = error instanceof DataDeleteError ? error.code : "DATA_DELETE_EXECUTION_FAILED";
      const failure = planDataJobFailure({ attempt: row.attempt, maxAttempts: row.maxAttempts,
        errorCode: code, retryable: error instanceof DataDeleteError && error.retryable, now: now.toISOString() });
      const state = failure.retryable ? "RETRY_WAIT" : "FAILED";
      await tx.dataDeletionIntent.update({ where: { id: row.id }, data: { state, errorCode: code, leaseOwner: null,
        leaseExpiresAt: null, executionPid: null, nextAttemptAt: failure.nextAttemptAt ? new Date(failure.nextAttemptAt) : null, revision: { increment: 1 } } });
      return state;
    });
  } catch (failure) {
    if (failure instanceof DataDeleteError && failure.code === "DATA_DELETE_LEASE_LOST") return "LEASE_LOST";
    throw failure;
  }
}
