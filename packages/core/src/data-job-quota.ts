export const DATA_JOB_QUOTA_KINDS = ["EXPORT", "SEARCH_INDEX_REBUILD", "RANKING_REBUILD"] as const;
export const DATA_JOB_QUOTA_ACTIVE_STATUSES = ["QUEUED", "RUNNING", "PAUSED", "CANCEL_REQUESTED", "FAILED"] as const;
export const DATA_JOB_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DATA_JOB_QUOTA_MAX_LIMIT = 2_147_483_647;

export type DataJobQuotaEnvironment = Readonly<Record<string, string | undefined>>;
export interface DataJobQuotaPolicy { maxActiveJobs: number; maxExports24h: number }
export interface DataJobQuotaUsage { activeJobs: number; exports24h: number }
export type DataJobQuotaErrorCode = "DATA_JOB_QUOTA_ACTIVE_LIMIT" | "DATA_JOB_QUOTA_EXPORT_LIMIT"
  | "DATA_JOB_QUOTA_CONFIG_INVALID" | "DATA_JOB_QUOTA_USAGE_UNAVAILABLE"
  | "DATA_JOB_QUOTA_ISOLATION_UNSUPPORTED" | "DATA_JOB_QUOTA_BUSY";

export class DataJobQuotaPolicyError extends Error {
  readonly code = "DATA_JOB_QUOTA_CONFIG_INVALID";
  constructor() { super("DATA_JOB_QUOTA_CONFIG_INVALID"); this.name = "DataJobQuotaPolicyError"; }
}

export function isDataJobQuotaKind(kind: string): boolean {
  return DATA_JOB_QUOTA_KINDS.includes(kind as typeof DATA_JOB_QUOTA_KINDS[number]);
}

/** 独立于通用身份配置校验：错误额度只阻止新增受控任务，不能阻断学习和取消。 */
export function readDataJobQuotaPolicy(env: DataJobQuotaEnvironment): DataJobQuotaPolicy | null {
  if (env.DATA_JOB_QUOTA_ENABLED === undefined || env.DATA_JOB_QUOTA_ENABLED === "false") return null;
  if (env.DATA_JOB_QUOTA_ENABLED !== "true") throw new DataJobQuotaPolicyError();
  return { maxActiveJobs: quotaLimit(env.DATA_JOB_QUOTA_MAX_ACTIVE_JOBS), maxExports24h: quotaLimit(env.DATA_JOB_QUOTA_MAX_EXPORTS_24H) };
}

export function dataJobQuotaRejection(policy: DataJobQuotaPolicy, usage: DataJobQuotaUsage, kind: string): DataJobQuotaErrorCode | null {
  if (!isDataJobQuotaKind(kind)) return null;
  if (![policy.maxActiveJobs, policy.maxExports24h].every(value => Number.isSafeInteger(value) && value >= 0 && value <= DATA_JOB_QUOTA_MAX_LIMIT)) {
    return "DATA_JOB_QUOTA_CONFIG_INVALID";
  }
  if (![usage.activeJobs, usage.exports24h].every(value => Number.isSafeInteger(value) && value >= 0)) return "DATA_JOB_QUOTA_USAGE_UNAVAILABLE";
  if (usage.activeJobs >= policy.maxActiveJobs) return "DATA_JOB_QUOTA_ACTIVE_LIMIT";
  if (kind === "EXPORT" && usage.exports24h >= policy.maxExports24h) return "DATA_JOB_QUOTA_EXPORT_LIMIT";
  return null;
}

function quotaLimit(value: string | undefined): number {
  if (value === undefined || !/^(0|[1-9]\d{0,9})$/.test(value)) throw new DataJobQuotaPolicyError();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > DATA_JOB_QUOTA_MAX_LIMIT) throw new DataJobQuotaPolicyError();
  return result;
}
