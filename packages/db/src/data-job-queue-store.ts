import { DATA_JOB_QUEUE_VERSION, dataJobKinds } from "@areaforge/core";
import type { Prisma } from "../generated/prisma/client";
import { DataJobQueueError, type DataJobLease, type DataJobPartition, type DataQueueTransaction, type QueuedDataJob } from "./data-job-queue-types";

export function queueIdentifier(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(value)) throw new DataJobQueueError("DATA_JOB_IDENTIFIER_INVALID");
  return value;
}

export function validateQueueKinds(kinds: readonly string[]): void {
  if (kinds.length === 0 || new Set(kinds).size !== kinds.length || kinds.some((kind) => !dataJobKinds.includes(kind as typeof dataJobKinds[number]))) {
    throw new DataJobQueueError("DATA_JOB_KINDS_INVALID");
  }
}

export function partitionWhere(partition: DataJobPartition = {}): Prisma.DataJobWhereInput {
  if (partition.requestedByUserId !== undefined) queueIdentifier(partition.requestedByUserId);
  if (partition.workspaceId !== undefined && partition.workspaceId !== null) queueIdentifier(partition.workspaceId);
  return { requestedByUserId: partition.requestedByUserId, workspaceId: partition.workspaceId };
}

export async function queueClock(tx: DataQueueTransaction): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
  if (!row) throw new DataJobQueueError("DATA_JOB_CLOCK_UNAVAILABLE");
  return row.now;
}

export async function lockQueuedDataJob(tx: DataQueueTransaction, jobId: string): Promise<QueuedDataJob> {
  queueIdentifier(jobId);
  await tx.$queryRaw`SELECT "id" FROM "DataJob" WHERE "id" = ${jobId} FOR UPDATE`;
  const row = await tx.dataJob.findUnique({ where: { id: jobId } });
  if (!row || row.queueVersion !== DATA_JOB_QUEUE_VERSION) throw new DataJobQueueError("DATA_JOB_QUEUE_NOT_FOUND");
  return row;
}

/** 与账户冻结、成员移除、工作区归档共用行锁，避免检查后再使用的权限窗口。 */
export async function assertQueueScope(tx: DataQueueTransaction, row: Pick<QueuedDataJob, "scope" | "requestedByUserId" | "workspaceId">): Promise<void> {
  const users = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT "status" FROM "User" WHERE "id" = ${row.requestedByUserId} FOR SHARE
  `;
  if (users[0]?.status !== "ACTIVE") throw new DataJobQueueError("DATA_JOB_SCOPE_REVOKED");
  if (row.scope === "ACCOUNT" && row.workspaceId === null) return;
  if (row.scope !== "WORKSPACE" || !row.workspaceId) throw new DataJobQueueError("DATA_JOB_SCOPE_INVALID");
  const workspaces = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT "status" FROM "ExamWorkspace" WHERE "id" = ${row.workspaceId} FOR SHARE
  `;
  const members = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT "status" FROM "WorkspaceMembership"
    WHERE "workspaceId" = ${row.workspaceId} AND "userId" = ${row.requestedByUserId} FOR SHARE
  `;
  if (workspaces[0]?.status !== "ACTIVE" || members[0]?.status !== "ACTIVE") throw new DataJobQueueError("DATA_JOB_SCOPE_REVOKED");
}

export function assertQueueLease(row: QueuedDataJob, lease: DataJobLease, now: Date): void {
  const sameScope = row.kind === lease.kind && row.scope === lease.scope
    && row.requestedByUserId === lease.requestedByUserId && row.workspaceId === lease.workspaceId;
  if (!sameScope || row.id !== lease.jobId || row.leaseOwner !== lease.workerId || row.leaseVersion !== lease.leaseVersion
    || !row.leaseExpiresAt || row.leaseExpiresAt <= now || row.expiresAt <= now
    || (row.status !== "RUNNING" && row.status !== "CANCEL_REQUESTED")) {
    throw new DataJobQueueError("DATA_JOB_LEASE_LOST");
  }
}

export function toDataJobLease(row: QueuedDataJob): DataJobLease {
  if (!row.leaseOwner || !row.leaseExpiresAt) throw new DataJobQueueError("DATA_JOB_LEASE_LOST");
  return {
    jobId: row.id, kind: row.kind, scope: row.scope, requestedByUserId: row.requestedByUserId,
    workspaceId: row.workspaceId, workerId: row.leaseOwner, leaseVersion: row.leaseVersion,
    attempt: row.attempt, leaseExpiresAt: row.leaseExpiresAt,
    payloadJson: row.resultJson,
  };
}

export async function updateQueuedDataJob(tx: DataQueueTransaction, row: QueuedDataJob, data: Prisma.DataJobUpdateInput): Promise<QueuedDataJob> {
  const now = await queueClock(tx);
  // 兼容现有 API 的毫秒 revision，但 fencing 不依赖时间精度。
  return tx.dataJob.update({ where: { id: row.id }, data: {
    ...data, updatedAt: new Date(Math.max(now.getTime(), row.updatedAt.getTime() + 1)),
  } });
}

export async function auditQueuedDataJob(tx: DataQueueTransaction, row: QueuedDataJob, action: string): Promise<void> {
  await tx.auditEvent.create({ data: {
    actorId: row.requestedByUserId, action, entityType: "DataJob", entityId: row.id,
    metadata: { workspaceId: row.workspaceId, kind: row.kind, status: row.status, attempt: row.attempt, errorCode: row.errorCode },
  } });
}

export const releasedQueueLease = { leaseOwner: null, leaseExpiresAt: null, pauseRequested: false, nextAttemptAt: null } as const;
