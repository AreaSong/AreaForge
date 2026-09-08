import { DATA_JOB_QUEUE_VERSION, validateDataJobAttempts, validateDataJobLeaseDuration } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { DataJobQueueError, type ClaimDataJobInput, type DataJobLease, type DataJobPartition, type DataQueueClient, type DataQueueTransaction, type EnqueueDataJobInput } from "./data-job-queue-types";
import { assertQueueScope, auditQueuedDataJob, partitionWhere, queueClock, queueIdentifier, releasedQueueLease, toDataJobLease, updateQueuedDataJob, validateQueueKinds } from "./data-job-queue-store";

export async function enqueueDataJob(client: DataQueueClient, input: EnqueueDataJobInput) {
  validateEnqueue(input);
  try {
    return await client.$transaction((tx) => enqueueDataJobInTransaction(tx, input));
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const identity = { requestedByUserId: input.requestedByUserId, idempotencyKey: input.idempotencyKey };
    const existing = await client.dataJob.findUnique({ where: { requestedByUserId_idempotencyKey: identity } });
    if (!existing) throw error;
    return assertSameRequest(existing, input);
  }
}

/** Enqueue inside an existing business transaction; no nested transaction is opened. */
export async function enqueueDataJobInTransaction(
  tx: DataQueueTransaction,
  input: EnqueueDataJobInput,
) {
  validateEnqueue(input);
  const { payloadJson, ...queueInput } = input;
  const identity = { requestedByUserId: input.requestedByUserId, idempotencyKey: input.idempotencyKey };
  await assertQueueScope(tx, input);
  const existing = await tx.dataJob.findUnique({ where: { requestedByUserId_idempotencyKey: identity } });
  if (existing) return assertSameRequest(existing, input);
  const now = await queueClock(tx);
  if (input.expiresAt <= now) throw new DataJobQueueError("DATA_JOB_EXPIRED");
  const row = await tx.dataJob.create({ data: {
    ...queueInput, maxAttempts: input.maxAttempts ?? 5, queueVersion: DATA_JOB_QUEUE_VERSION,
    nextAttemptAt: now, status: "QUEUED",
    resultJson: payloadJson,
  } });
  await auditQueuedDataJob(tx, row, "DATA_JOB_ENQUEUED");
  return row;
}

function validateEnqueue(input: EnqueueDataJobInput): void {
  validateQueueKinds([input.kind]);
  queueIdentifier(input.requestedByUserId);
  queueIdentifier(input.idempotencyKey);
  if (input.workspaceId !== null) queueIdentifier(input.workspaceId);
  if ((input.scope === "ACCOUNT") !== (input.workspaceId === null)) throw new DataJobQueueError("DATA_JOB_SCOPE_INVALID");
  if (!/^(sha256:)?[a-f0-9]{64}$/.test(input.requestFingerprint)) throw new DataJobQueueError("DATA_JOB_FINGERPRINT_INVALID");
  if (!Number.isFinite(input.expiresAt.getTime())) throw new DataJobQueueError("DATA_JOB_EXPIRY_INVALID");
  validateDataJobAttempts(input.maxAttempts ?? 5);
}

function assertSameRequest<T extends { queueVersion: number; kind: string; scope: string; workspaceId: string | null; requestFingerprint: string }>(row: T, input: EnqueueDataJobInput): T {
  if (row.queueVersion !== DATA_JOB_QUEUE_VERSION || row.kind !== input.kind || row.scope !== input.scope
    || row.workspaceId !== input.workspaceId || row.requestFingerprint !== input.requestFingerprint) {
    throw new DataJobQueueError("DATA_JOB_IDEMPOTENCY_CONFLICT");
  }
  return row;
}

export function queuePartitionSql(partition: DataJobPartition = {}): Prisma.Sql {
  partitionWhere(partition);
  const requester = partition.requestedByUserId === undefined ? Prisma.empty
    : Prisma.sql`AND "requestedByUserId" = ${partition.requestedByUserId}`;
  const workspace = partition.workspaceId === undefined ? Prisma.empty : partition.workspaceId === null
    ? Prisma.sql`AND "workspaceId" IS NULL` : Prisma.sql`AND "workspaceId" = ${partition.workspaceId}`;
  return Prisma.sql`${requester} ${workspace}`;
}

/** SKIP LOCKED 使被锁定的工作区任务不阻塞其他工作区的领取。 */
export async function claimQueuedDataJob(client: DataQueueClient, input: ClaimDataJobInput): Promise<DataJobLease | null> {
  queueIdentifier(input.workerId);
  validateQueueKinds(input.kinds);
  validateDataJobLeaseDuration(input.leaseMs);
  const partition = queuePartitionSql(input.partition);
  return client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "DataJob" WHERE "queueVersion" = ${DATA_JOB_QUEUE_VERSION}
        AND "kind"::text IN (${Prisma.join([...input.kinds])}) ${partition}
        AND "expiresAt" > clock_timestamp() AND "nextAttemptAt" <= clock_timestamp()
        AND "attempt" < "maxAttempts" AND "deadLetteredAt" IS NULL AND NOT "pauseRequested"
        AND ("status" = 'QUEUED' OR ("status" = 'FAILED' AND "retryable"))
      ORDER BY "nextAttemptAt", "createdAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED
    `);
    if (!rows[0]) return null;
    const row = await tx.dataJob.findUniqueOrThrow({ where: { id: rows[0].id } });
    if (!await claimScopeAllowed(tx, row)) return null;
    const now = await queueClock(tx);
    if (row.expiresAt <= now) return null;
    const claimed = await updateQueuedDataJob(tx, row, {
      status: "RUNNING", attempt: { increment: 1 }, leaseVersion: { increment: 1 },
      leaseOwner: input.workerId, leaseExpiresAt: new Date(Math.min(row.expiresAt.getTime(), now.getTime() + input.leaseMs)),
      nextAttemptAt: null, retryable: false, errorCode: null, progress: 0,
    });
    await auditQueuedDataJob(tx, claimed, "DATA_JOB_CLAIMED");
    return toDataJobLease(claimed);
  });
}

async function claimScopeAllowed(tx: DataQueueTransaction, row: Awaited<ReturnType<DataQueueTransaction["dataJob"]["findUniqueOrThrow"]>>): Promise<boolean> {
  try {
    await assertQueueScope(tx, row);
    return true;
  } catch (error) {
    if (!(error instanceof DataJobQueueError) || error.code !== "DATA_JOB_SCOPE_REVOKED") throw error;
    const now = await queueClock(tx);
    const failed = await updateQueuedDataJob(tx, row, {
      ...releasedQueueLease, status: "FAILED", errorCode: error.code, retryable: false, deadLetteredAt: now,
    });
    await auditQueuedDataJob(tx, failed, "DATA_JOB_DEAD_LETTERED");
    return false;
  }
}
