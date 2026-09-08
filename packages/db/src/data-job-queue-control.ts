import { DataJobQueueError, type DataQueueClient } from "./data-job-queue-types";
import { assertQueueScope, auditQueuedDataJob, lockQueuedDataJob, queueClock, releasedQueueLease, updateQueuedDataJob } from "./data-job-queue-store";

export type DataJobQueueControl = "PAUSE" | "RESUME" | "CANCEL" | "REPLAY";

/** actor 必须由服务端认证获得；仅允许请求者控制自己的任务。 */
export async function controlQueuedDataJob(client: DataQueueClient, input: {
  jobId: string;
  actorId: string;
  expectedRevision: number;
  action: DataJobQueueControl;
}) {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new DataJobQueueError("DATA_JOB_REVISION_INVALID");
  return client.$transaction(async (tx) => {
    const row = await lockQueuedDataJob(tx, input.jobId);
    if (row.requestedByUserId !== input.actorId) throw new DataJobQueueError("DATA_JOB_QUEUE_NOT_FOUND");
    if (row.updatedAt.getTime() !== input.expectedRevision) throw new DataJobQueueError("DATA_JOB_REVISION_CONFLICT");
    const now = await queueClock(tx);
    if (row.expiresAt <= now) throw new DataJobQueueError("DATA_JOB_EXPIRED");
    await assertQueueScope(tx, row);
    const data = controlData(row, input.action, now);
    const updated = await updateQueuedDataJob(tx, row, data);
    await auditQueuedDataJob(tx, updated, `DATA_JOB_${input.action}_REQUESTED`);
    return updated;
  });
}

function controlData(row: Awaited<ReturnType<typeof lockQueuedDataJob>>, action: DataJobQueueControl, now: Date) {
  const active = ["QUEUED", "RUNNING", "FAILED", "PAUSED", "CANCEL_REQUESTED"].includes(row.status);
  if (action === "CANCEL" && active) return row.status === "RUNNING" || row.status === "CANCEL_REQUESTED"
    ? { status: "CANCEL_REQUESTED" as const, pauseRequested: false }
    : { ...releasedQueueLease, status: "CANCELLED" as const, retryable: false, deadLetteredAt: null };
  if (action === "PAUSE" && ["QUEUED", "RUNNING", "FAILED"].includes(row.status) && !row.deadLetteredAt) {
    return row.status === "RUNNING" ? { pauseRequested: true }
      : { ...releasedQueueLease, status: "PAUSED" as const, retryable: false };
  }
  if (action === "RESUME" && row.status === "PAUSED" && row.attempt < row.maxAttempts) {
    return { ...releasedQueueLease, status: "QUEUED" as const, nextAttemptAt: now, retryable: false };
  }
  if (action === "REPLAY" && row.status === "FAILED") {
    // 人工重放给出新的尝试预算，但永远不重置租约代次。
    return { ...releasedQueueLease, status: "QUEUED" as const, nextAttemptAt: now,
      attempt: 0, progress: 0, errorCode: null, retryable: false, deadLetteredAt: null };
  }
  throw new DataJobQueueError("DATA_JOB_CONTROL_REJECTED");
}
