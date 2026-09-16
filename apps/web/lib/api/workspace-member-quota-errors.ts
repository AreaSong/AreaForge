import type { WorkspaceMemberQuotaErrorCode } from "@areaforge/core";

const feedback: Record<WorkspaceMemberQuotaErrorCode, { status: number; message: string }> = {
  WORKSPACE_MEMBER_QUOTA_LIMIT: { status: 429, message: "这个工作区的成员席位已满。请联系工作区所有者释放席位后，再次接受邀请；本次未加入工作区。" },
  WORKSPACE_MEMBER_QUOTA_CONFIG_INVALID: { status: 503, message: "成员席位配置暂不可用，本次未加入工作区。请稍后重试，或联系工作区所有者。" },
  WORKSPACE_MEMBER_QUOTA_USAGE_UNAVAILABLE: { status: 503, message: "暂时无法确认成员席位，本次未加入工作区。请稍后重试。" },
  WORKSPACE_MEMBER_QUOTA_SCOPE_INVALID: { status: 404, message: "工作区当前不可加入，请联系工作区所有者核对邀请状态。" },
  WORKSPACE_MEMBER_QUOTA_BUSY: { status: 503, message: "成员状态正在变化，本次未加入工作区。请稍后再次接受邀请。" },
  WORKSPACE_MEMBER_QUOTA_ISOLATION_UNSUPPORTED: { status: 503, message: "成员席位服务暂不可用，本次未加入工作区。请稍后重试。" },
};

function quotaFeedback(code?: string) {
  return code && Object.hasOwn(feedback, code) ? feedback[code as WorkspaceMemberQuotaErrorCode] : undefined;
}
export function workspaceMemberQuotaErrorStatus(code: string): number | undefined { return quotaFeedback(code)?.status; }
export function workspaceMemberQuotaErrorText(code?: string): string | undefined { return quotaFeedback(code)?.message; }
