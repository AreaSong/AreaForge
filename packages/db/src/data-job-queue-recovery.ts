import { DATA_JOB_QUEUE_VERSION, type DataJobKind } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { DataJobQueueError, type DataJobPartition, type DataQueueClient } from "./data-job-queue-types";
import { queuePartitionSql } from "./data-job-queue";
import { auditQueuedDataJob, partitionWhere, queueClock, releasedQueueLease, updateQueuedDataJob, validateQueueKinds } from "./data-job-queue-store";
import { persistQueueFailure, settleQueueControl } from "./data-job-queue-lease";

export async function recoverQueuedDataJobs(client: DataQueueClient, input: { kinds: readonly DataJobKind[]; partition?: DataJobPartition; limit?: number }): Promise<number> {
  validateQueueKinds(input.kinds);
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DataJobQueueError("DATA_JOB_RECOVERY_LIMIT_INVALID");
  const partition = queuePartitionSql(input.partition);
  return client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "DataJob" WHERE "queueVersion" = ${DATA_JOB_QUEUE_VERSION}
        AND "kind"::text IN (${Prisma.join([...input.kinds])}) ${partition}
        AND "status" IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'FAILED', 'PAUSED')
        AND (("status" IN ('RUNNING', 'CANCEL_REQUESTED') AND "leaseExpiresAt" <= clock_timestamp())
          OR ("expiresAt" <= clock_timestamp() AND "deadLetteredAt" IS NULL))
      ORDER BY "leaseExpiresAt" NULLS LAST, "expiresAt", "id" LIMIT ${limit} FOR UPDATE SKIP LOCKED
    `);
    for (const { id } of rows) {
      const row = await tx.dataJob.findUniqueOrThrow({ where: { id } });
      if (await settleQueueControl(tx, row)) continue;
      const now = await queueClock(tx);
      if (row.expiresAt <= now) {
        const expired = await updateQueuedDataJob(tx, row, {
          ...releasedQueueLease, status: "EXPIRED", retryable: false, errorCode: "DATA_JOB_EXPIRED",
        });
        await auditQueuedDataJob(tx, expired, "DATA_JOB_EXPIRED");
      } else {
        await persistQueueFailure(tx, row, { now, errorCode: "LEASE_EXPIRED", retryable: true });
      }
    }
    return rows.length;
  });
}

export async function getDataJobQueueSnapshot(client: DataQueueClient, partition?: DataJobPartition) {
  const where = { queueVersion: DATA_JOB_QUEUE_VERSION, ...partitionWhere(partition) };
  return client.$transaction(async (tx) => {
    const now = await queueClock(tx);
    const [states, retryWaiting, deadLetters, expiredLeases, oldest] = await Promise.all([
      tx.dataJob.groupBy({ by: ["status"], where, _count: { _all: true } }),
      tx.dataJob.count({ where: { ...where, status: "FAILED", retryable: true, nextAttemptAt: { gt: now } } }),
      tx.dataJob.count({ where: { ...where, deadLetteredAt: { not: null } } }),
      tx.dataJob.count({ where: { ...where, status: { in: ["RUNNING", "CANCEL_REQUESTED"] }, leaseExpiresAt: { lte: now } } }),
      tx.dataJob.findFirst({ where: { ...where, status: { in: ["QUEUED", "RUNNING", "PAUSED", "CANCEL_REQUESTED"] } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ]);
    return {
      queueVersion: DATA_JOB_QUEUE_VERSION, asOf: now.toISOString(),
      states: Object.fromEntries(states.map((entry) => [entry.status, entry._count._all])),
      retryWaiting, deadLetters, expiredLeases, oldestActiveAt: oldest?.createdAt.toISOString() ?? null,
    };
  }, { isolationLevel: "RepeatableRead" });
}
