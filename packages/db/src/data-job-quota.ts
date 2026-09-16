import { DATA_JOB_QUOTA_ACTIVE_STATUSES, DATA_JOB_QUOTA_KINDS, DATA_JOB_QUOTA_WINDOW_MS,
  DataJobQuotaPolicyError, dataJobQuotaRejection, isDataJobQuotaKind, readDataJobQuotaPolicy,
  type DataJobQuotaEnvironment } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { DataJobQueueError, type DataQueueTransaction, type EnqueueDataJobInput } from "./data-job-queue-types";
import { queueClock } from "./data-job-queue-store";

type Admission = Pick<EnqueueDataJobInput, "kind" | "scope" | "workspaceId" | "requestedByUserId">;

/** 必须在授权与同键复用之后执行；数据库事务同时保护额度判断和随后的任务插入。 */
export async function checkDataJobQuotaAdmission(tx: DataQueueTransaction, input: Admission, env: DataJobQuotaEnvironment): Promise<Date | undefined> {
  if (!isDataJobQuotaKind(input.kind)) return;
  let policy;
  try { policy = readDataJobQuotaPolicy(env); }
  catch (error) { if (error instanceof DataJobQuotaPolicyError) throw new DataJobQueueError(error.code); throw error; }
  if (!policy) return;
  const [transaction] = await tx.$queryRaw<Array<{ isolation: string }>>`SELECT current_setting('transaction_isolation') AS isolation`;
  // 同一数据库混用 ReadCommitted 与 Serializable 不能保证旧快照下的额度谓词冲突。
  if (transaction?.isolation !== "serializable") throw new DataJobQueueError("DATA_JOB_QUOTA_ISOLATION_UNSUPPORTED");
  await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
  await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms'`;
  const lockKey = `areaforge:data-job-quota:v1:${JSON.stringify([input.requestedByUserId, input.scope, input.workspaceId])}`;
  const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired`;
  if (lock?.acquired !== true) throw new DataJobQueueError("DATA_JOB_QUOTA_BUSY");
  const now = await queueClock(tx); const since = new Date(now.getTime() - DATA_JOB_QUOTA_WINDOW_MS);
  const [usage] = await tx.$queryRaw<Array<{ activeJobs: bigint; exports24h: bigint }>>(Prisma.sql`
    SELECT COUNT(*) FILTER (WHERE "expiresAt">${now} AND status::text IN (${Prisma.join([...DATA_JOB_QUOTA_ACTIVE_STATUSES])})) AS "activeJobs",
      COUNT(*) FILTER (WHERE kind='EXPORT' AND "createdAt">${since}) AS "exports24h"
    FROM "DataJob" WHERE "queueVersion"=1 AND "requestedByUserId"=${input.requestedByUserId}
      AND scope=${input.scope}::"DataJobScope" AND "workspaceId" IS NOT DISTINCT FROM ${input.workspaceId}
      AND kind::text IN (${Prisma.join([...DATA_JOB_QUOTA_KINDS])})
      AND ("expiresAt">${now} OR (kind='EXPORT' AND "createdAt">${since}))
  `);
  if (!usage) throw new DataJobQueueError("DATA_JOB_QUOTA_USAGE_UNAVAILABLE");
  const rejected = dataJobQuotaRejection(policy, { activeJobs: Number(usage.activeJobs), exports24h: Number(usage.exports24h) }, input.kind);
  if (rejected) throw new DataJobQueueError(rejected);
  return now;
}
