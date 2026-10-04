import type { WorkspaceStorageQuotaErrorCode } from "@areaforge/core";

const errors: Record<WorkspaceStorageQuotaErrorCode, { status: number; message: string }> = {
  WORKSPACE_STORAGE_QUOTA_LIMIT: { status: 429, message: "当前工作区的附件存储额度已满。请在文件清理完成后重试；学习与已有下载不受此限额影响。" },
  WORKSPACE_STORAGE_QUOTA_CONFIG_INVALID: { status: 503, message: "存储额度配置暂不可用，新的上传已暂停。学习与已有下载不受影响。" },
  WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN: { status: 503, message: "暂时无法安全确认文件占用，请稍后重试或联系维护者检查存储；不会把未知文件当作空余空间。" },
  WORKSPACE_STORAGE_QUOTA_BUSY: { status: 503, message: "文件或额度正在处理中，请稍后重试；同一请求不会重复扣除额度。" },
  WORKSPACE_STORAGE_QUOTA_ISOLATION_UNSUPPORTED: { status: 503, message: "当前存储准入暂不可用，请稍后重试；已保存内容保持不变。" },
};
export function workspaceStorageQuotaErrorStatus(code?: string): number | undefined {
  return code && Object.hasOwn(errors, code) ? errors[code as WorkspaceStorageQuotaErrorCode].status : undefined;
}
export function workspaceStorageQuotaErrorText(code?: string): string | undefined {
  return code && Object.hasOwn(errors, code) ? errors[code as WorkspaceStorageQuotaErrorCode].message : undefined;
}
