import { DATA_JOB_QUOTA_MAX_LIMIT, DataJobQuotaPolicyError, type DataJobQuotaEnvironment } from "./data-job-quota";

export interface DataJobTotalQuotaPolicy { maxUserJobs: number; maxWorkspaceJobs: number; maxInstanceJobs: number }
export interface DataJobTotalQuotaUsage { userJobs: number; workspaceJobs: number; instanceJobs: number }
export type DataJobTotalQuotaErrorCode = "DATA_JOB_QUOTA_USER_ACTIVE_LIMIT" | "DATA_JOB_QUOTA_WORKSPACE_ACTIVE_LIMIT"
  | "DATA_JOB_QUOTA_INSTANCE_ACTIVE_LIMIT" | "DATA_JOB_QUOTA_CONFIG_INVALID" | "DATA_JOB_QUOTA_USAGE_UNAVAILABLE";
export interface WorkspaceMemberQuotaPolicy { maxSeats: number }
export type WorkspaceMemberQuotaErrorCode = "WORKSPACE_MEMBER_QUOTA_LIMIT" | "WORKSPACE_MEMBER_QUOTA_CONFIG_INVALID"
  | "WORKSPACE_MEMBER_QUOTA_USAGE_UNAVAILABLE" | "WORKSPACE_MEMBER_QUOTA_SCOPE_INVALID"
  | "WORKSPACE_MEMBER_QUOTA_BUSY" | "WORKSPACE_MEMBER_QUOTA_ISOLATION_UNSUPPORTED";

export class WorkspaceMemberQuotaError extends Error {
  constructor(readonly code: WorkspaceMemberQuotaErrorCode) { super(code); this.name = "WorkspaceMemberQuotaError"; }
}

export function requiresDataJobQuotaSerializable(env: DataJobQuotaEnvironment): boolean {
  return env.DATA_JOB_QUOTA_ENABLED === "true" || env.DATA_JOB_TOTAL_QUOTA_ENABLED === "true";
}

export function readDataJobTotalQuotaPolicy(env: DataJobQuotaEnvironment): DataJobTotalQuotaPolicy | null {
  if (env.DATA_JOB_TOTAL_QUOTA_ENABLED === undefined || env.DATA_JOB_TOTAL_QUOTA_ENABLED === "false") return null;
  const values = [env.DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER, env.DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE,
    env.DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE].map(value => parseLimit(value, 0));
  if (env.DATA_JOB_TOTAL_QUOTA_ENABLED !== "true" || values.some(value => value === null)) throw new DataJobQuotaPolicyError();
  return { maxUserJobs: values[0]!, maxWorkspaceJobs: values[1]!, maxInstanceJobs: values[2]! };
}

export function dataJobTotalQuotaRejection(policy: DataJobTotalQuotaPolicy, usage: DataJobTotalQuotaUsage,
  workspaceScoped: boolean): DataJobTotalQuotaErrorCode | null {
  if (![policy.maxUserJobs, policy.maxWorkspaceJobs, policy.maxInstanceJobs].every(value => validLimit(value, 0))) {
    return "DATA_JOB_QUOTA_CONFIG_INVALID";
  }
  if (![usage.userJobs, usage.workspaceJobs, usage.instanceJobs].every(validUsage)) return "DATA_JOB_QUOTA_USAGE_UNAVAILABLE";
  if (usage.userJobs >= policy.maxUserJobs) return "DATA_JOB_QUOTA_USER_ACTIVE_LIMIT";
  if (workspaceScoped && usage.workspaceJobs >= policy.maxWorkspaceJobs) return "DATA_JOB_QUOTA_WORKSPACE_ACTIVE_LIMIT";
  if (usage.instanceJobs >= policy.maxInstanceJobs) return "DATA_JOB_QUOTA_INSTANCE_ACTIVE_LIMIT";
  return null;
}

/** 开关和限额只在新成员准入解析，不能让坏配额配置破坏个人学习与既有控制。 */
export function readWorkspaceMemberQuotaPolicy(env: DataJobQuotaEnvironment): WorkspaceMemberQuotaPolicy | null {
  if (env.WORKSPACE_MEMBER_QUOTA_ENABLED === undefined || env.WORKSPACE_MEMBER_QUOTA_ENABLED === "false") return null;
  const maxSeats = parseLimit(env.WORKSPACE_MEMBER_QUOTA_MAX_SEATS, 1);
  if (env.WORKSPACE_MEMBER_QUOTA_ENABLED !== "true" || maxSeats === null) {
    throw new WorkspaceMemberQuotaError("WORKSPACE_MEMBER_QUOTA_CONFIG_INVALID");
  }
  return { maxSeats };
}

export function workspaceMemberQuotaRejection(policy: WorkspaceMemberQuotaPolicy, occupiedSeats: number): WorkspaceMemberQuotaErrorCode | null {
  if (!validLimit(policy.maxSeats, 1)) return "WORKSPACE_MEMBER_QUOTA_CONFIG_INVALID";
  if (!validUsage(occupiedSeats) || occupiedSeats < 1) return "WORKSPACE_MEMBER_QUOTA_USAGE_UNAVAILABLE";
  return occupiedSeats >= policy.maxSeats ? "WORKSPACE_MEMBER_QUOTA_LIMIT" : null;
}

function validUsage(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function validLimit(value: number, minimum: number): boolean {
  return validUsage(value) && value >= minimum && value <= DATA_JOB_QUOTA_MAX_LIMIT;
}
function parseLimit(value: string | undefined, minimum: number): number | null {
  if (value === undefined || !/^(0|[1-9]\d{0,9})$/.test(value)) return null;
  const parsed = Number(value);
  return validLimit(parsed, minimum) ? parsed : null;
}
