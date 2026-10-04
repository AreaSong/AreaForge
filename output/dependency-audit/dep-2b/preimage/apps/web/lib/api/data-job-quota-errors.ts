import type { DataJobQuotaErrorCode, DataJobTotalQuotaErrorCode } from "@areaforge/core";

type QuotaErrorCode = DataJobQuotaErrorCode | DataJobTotalQuotaErrorCode;
const feedback: Record<QuotaErrorCode, { status: number; message: string }> = {
  DATA_JOB_QUOTA_ACTIVE_LIMIT: { status: 429, message: "当前分区的任务名额已满。可取消不再需要的任务，或等待完成、到期后重试。" },
  DATA_JOB_QUOTA_EXPORT_LIMIT: { status: 429, message: "当前分区的 24 小时导出额度已用尽。请稍后重试；取消任务不会返还次数。" },
  DATA_JOB_QUOTA_USER_ACTIVE_LIMIT: { status: 429, message: "你在所有工作区的后台任务总名额已满。可取消不再需要的任务，或等待完成、到期后重试。" },
  DATA_JOB_QUOTA_WORKSPACE_ACTIVE_LIMIT: { status: 429, message: "当前工作区的后台任务总名额已满。可处理自己不再需要的任务，或稍后重试。" },
  DATA_JOB_QUOTA_INSTANCE_ACTIVE_LIMIT: { status: 429, message: "系统后台任务总名额暂满，请稍后重试。学习和已有任务操作不受此限制。" },
  DATA_JOB_QUOTA_CONFIG_INVALID: { status: 503, message: "任务配额配置暂不可用，未创建新任务。已有任务仍可按原规则操作。" },
  DATA_JOB_QUOTA_USAGE_UNAVAILABLE: { status: 503, message: "暂时无法确认任务额度，请稍后重试。已有任务仍可按原规则操作。" },
  DATA_JOB_QUOTA_ISOLATION_UNSUPPORTED: { status: 503, message: "任务配额暂不可用，请稍后重试。已有任务仍可按原规则操作。" },
  DATA_JOB_QUOTA_BUSY: { status: 503, message: "任务配额正在核对，请稍后重试；已接纳的请求不会重复创建任务。" },
};

function quotaFeedback(code?: string) {
  return code && Object.hasOwn(feedback, code) ? feedback[code as QuotaErrorCode] : undefined;
}

export function dataJobQuotaErrorStatus(code: string): number | undefined { return quotaFeedback(code)?.status; }
export function dataJobQuotaErrorText(code?: string): string | undefined { return quotaFeedback(code)?.message; }
