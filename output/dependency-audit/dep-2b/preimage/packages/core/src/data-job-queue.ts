import type { DataJobStatus } from "./data-jobs";

export const DATA_JOB_QUEUE_VERSION = 1;
export const DATA_JOB_MAX_LEASE_MS = 15 * 60 * 1000;

export interface DataJobFailurePlan {
  status: DataJobStatus;
  retryable: boolean;
  nextAttemptAt: string | null;
  deadLetteredAt: string | null;
  errorCode: string;
}

/** attempt 是已开始的次数；第五次失败不能再产生第六次自动执行。 */
export function planDataJobFailure(input: {
  attempt: number;
  maxAttempts: number;
  retryable: boolean;
  errorCode: string;
  now: string;
}): DataJobFailurePlan {
  validateDataJobAttempts(input.maxAttempts);
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) throw new TypeError("DATA_JOB_ATTEMPT_INVALID");
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new TypeError("DATA_JOB_TIME_INVALID");
  if (!/^[A-Z0-9_.:-]{1,80}$/.test(input.errorCode)) throw new TypeError("DATA_JOB_ERROR_CODE_INVALID");
  const retryable = input.retryable && input.attempt < input.maxAttempts;
  const delayMs = Math.min(3_600_000, 30_000 * 2 ** Math.min(input.attempt - 1, 10));
  return {
    status: "FAILED",
    retryable,
    nextAttemptAt: retryable ? new Date(nowMs + delayMs).toISOString() : null,
    deadLetteredAt: retryable ? null : new Date(nowMs).toISOString(),
    errorCode: input.errorCode,
  };
}

export function validateDataJobAttempts(maxAttempts: number): void {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new TypeError("DATA_JOB_MAX_ATTEMPTS_INVALID");
  }
}

export function validateDataJobLeaseDuration(leaseMs: number): void {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > DATA_JOB_MAX_LEASE_MS) {
    throw new TypeError("DATA_JOB_LEASE_DURATION_INVALID");
  }
}
