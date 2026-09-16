import { DATA_JOB_QUOTA_ACTIVE_STATUSES, DATA_JOB_QUOTA_KINDS, DataJobQuotaPolicyError, dataJobTotalQuotaRejection,
  isDataJobQuotaKind, readDataJobTotalQuotaPolicy, type DataJobQuotaEnvironment } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { DataJobQueueError, type DataQueueTransaction, type EnqueueDataJobInput } from "./data-job-queue-types";
import { queueClock } from "./data-job-queue-store";

type Admission = Pick<EnqueueDataJobInput, "kind" | "scope" | "workspaceId" | "requestedByUserId">;

/** 全局准入锁只持有到该请求提交；执行、学习和既有控制不争用这个锁。 */
export async function checkDataJobTotalQuotaAdmission(tx: DataQueueTransaction, input: Admission, env: DataJobQuotaEnvironment): Promise<Date | undefined> {
  if (!isDataJobQuotaKind(input.kind)) return;
  let policy;
  try { policy = readDataJobTotalQuotaPolicy(env); }
  catch (error) { if (error instanceof DataJobQuotaPolicyError) throw new DataJobQueueError(error.code); throw error; }
  if (!policy) return;
  const [transaction] = await tx.$queryRaw<Array<{ isolation: string }>>`SELECT current_setting('transaction_isolation') AS isolation`;
  if (transaction?.isolation !== "serializable") throw new DataJobQueueError("DATA_JOB_QUOTA_ISOLATION_UNSUPPORTED");
  await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
  await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms'`;
  const key = "areaforge:data-job-total-quota:v1";
  const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired`;
  if (lock?.acquired !== true) throw new DataJobQueueError("DATA_JOB_QUOTA_BUSY");
  const now = await queueClock(tx);
  // 原始计数保留冻结、停用与归档范围的未结算任务，不输出其标识或内容。
  const [usage] = await tx.$queryRaw<Array<{ userJobs: bigint; workspaceJobs: bigint; instanceJobs: bigint }>>(Prisma.sql`
    SELECT COUNT(*) FILTER (WHERE "requestedByUserId"=${input.requestedByUserId}) AS "userJobs",
      COUNT(*) FILTER (WHERE "workspaceId"=${input.workspaceId}) AS "workspaceJobs", COUNT(*) AS "instanceJobs"
    FROM "DataJob" WHERE "queueVersion"=1 AND "expiresAt">${now}
      AND status::text IN (${Prisma.join([...DATA_JOB_QUOTA_ACTIVE_STATUSES])})
      AND kind::text IN (${Prisma.join([...DATA_JOB_QUOTA_KINDS])})
  `);
  if (!usage) throw new DataJobQueueError("DATA_JOB_QUOTA_USAGE_UNAVAILABLE");
  const rejected = dataJobTotalQuotaRejection(policy, { userJobs: Number(usage.userJobs), workspaceJobs: Number(usage.workspaceJobs),
    instanceJobs: Number(usage.instanceJobs) }, input.scope === "WORKSPACE");
  if (rejected) throw new DataJobQueueError(rejected);
  return now;
}
