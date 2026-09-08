import { planDataJobFailure, validateDataJobLeaseDuration } from "@areaforge/core";
import { DataJobQueueError, type DataJobLease, type DataQueueClient, type DataQueueTransaction, type QueuedDataJob } from "./data-job-queue-types";
import { assertQueueLease, assertQueueScope, auditQueuedDataJob, lockQueuedDataJob, queueClock, releasedQueueLease, updateQueuedDataJob } from "./data-job-queue-store";

export async function heartbeatQueuedDataJob(client: DataQueueClient, input: { lease: DataJobLease; leaseMs: number; progress?: number }): Promise<"RUNNING" | "PAUSED" | "CANCELLED"> {
  validateDataJobLeaseDuration(input.leaseMs);
  if (input.progress !== undefined && (!Number.isFinite(input.progress) || input.progress < 0 || input.progress > 1)) {
    throw new DataJobQueueError("DATA_JOB_PROGRESS_INVALID");
  }
  return client.$transaction(async (tx) => {
    const row = await lockQueuedDataJob(tx, input.lease.jobId);
    const now = await queueClock(tx);
    assertQueueLease(row, input.lease, now);
    const stopped = await settleQueueControl(tx, row);
    if (stopped) return stopped;
    await assertQueueScope(tx, row);
    await updateQueuedDataJob(tx, row, {
      leaseExpiresAt: new Date(Math.min(row.expiresAt.getTime(), now.getTime() + input.leaseMs)),
      progress: Math.max(row.progress, input.progress ?? row.progress),
    });
    return "RUNNING";
  });
}

/** effect 只能使用传入事务；外部 IO 不能由这个事务承诺 exactly-once。 */
export async function commitQueuedDataJob(client: DataQueueClient, input: {
  lease: DataJobLease;
  effect: (tx: DataQueueTransaction, job: Readonly<QueuedDataJob>) => Promise<void>;
}): Promise<"SUCCEEDED" | "PAUSED" | "CANCELLED"> {
  return client.$transaction(async (tx) => {
    const row = await lockQueuedDataJob(tx, input.lease.jobId);
    assertQueueLease(row, input.lease, await queueClock(tx));
    const stopped = await settleQueueControl(tx, row);
    if (stopped) return stopped;
    await assertQueueScope(tx, row);
    await input.effect(tx, row);
    // SQL 副作用执行期间租约过期时整笔回滚，旧执行者不能留下半次完成。
    assertQueueLease(row, input.lease, await queueClock(tx));
    const finished = await updateQueuedDataJob(tx, row, {
      ...releasedQueueLease, status: "SUCCEEDED", progress: 1, errorCode: null, retryable: false, deadLetteredAt: null,
    });
    await auditQueuedDataJob(tx, finished, "DATA_JOB_SUCCEEDED");
    return "SUCCEEDED";
  }, { timeout: 15_000 });
}

export async function failQueuedDataJob(client: DataQueueClient, input: { lease: DataJobLease; errorCode: string; retryable: boolean }): Promise<void> {
  return client.$transaction(async (tx) => {
    const row = await lockQueuedDataJob(tx, input.lease.jobId);
    const now = await queueClock(tx);
    assertQueueLease(row, input.lease, now);
    if (await settleQueueControl(tx, row)) return;
    await persistQueueFailure(tx, row, { errorCode: input.errorCode, retryable: input.retryable, now });
  });
}

export async function persistQueueFailure(tx: DataQueueTransaction, row: QueuedDataJob, input: { errorCode: string; retryable: boolean; now: Date }): Promise<void> {
  const plan = planDataJobFailure({
    attempt: row.attempt, maxAttempts: row.maxAttempts, retryable: input.retryable,
    errorCode: input.errorCode, now: input.now.toISOString(),
  });
  const updated = await updateQueuedDataJob(tx, row, {
    ...releasedQueueLease, status: plan.status, retryable: plan.retryable, errorCode: plan.errorCode,
    nextAttemptAt: plan.nextAttemptAt ? new Date(plan.nextAttemptAt) : null,
    deadLetteredAt: plan.deadLetteredAt ? new Date(plan.deadLetteredAt) : null,
  });
  await auditQueuedDataJob(tx, updated, plan.retryable ? "DATA_JOB_RETRY_SCHEDULED" : "DATA_JOB_DEAD_LETTERED");
}

export async function settleQueueControl(tx: DataQueueTransaction, row: QueuedDataJob): Promise<"CANCELLED" | "PAUSED" | null> {
  const status = row.status === "CANCEL_REQUESTED" ? "CANCELLED" : row.pauseRequested ? "PAUSED" : null;
  if (!status) return null;
  // 主动暂停没有提交副作用，不消耗失败重试预算；代次仍保持递增。
  const attempt = status === "PAUSED" && row.status === "RUNNING" ? Math.max(0, row.attempt - 1) : row.attempt;
  const changed = await updateQueuedDataJob(tx, row, { ...releasedQueueLease, status, attempt, retryable: false });
  await auditQueuedDataJob(tx, changed, `DATA_JOB_${status}`);
  return status;
}
