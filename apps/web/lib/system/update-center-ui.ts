import type { AutoApplyPolicy, UpdateAction, UpdateCenterStatus } from "./update-center";

type UpdateOperationStatus = NonNullable<UpdateCenterStatus["lastOperation"]>["status"];

/**
 * 版本中心 UI 的共享文案与状态工具：更新弹窗与设置工作台共用同一份映射，
 * 避免错误码文案、动作标签在两个入口出现漂移。
 */

export function mergeFallbackOperation(
  status: UpdateCenterStatus,
  fallbackOperation: UpdateCenterStatus["lastOperation"],
): UpdateCenterStatus {
  if (!fallbackOperation || !shouldUseFallbackOperation(status.lastOperation, fallbackOperation)) return status;
  return {
    ...status,
    lastOperation: fallbackOperation,
    requestQueueLength: typeof status.requestQueueLength === "number"
      ? Math.max(status.requestQueueLength, 1)
      : status.requestQueueLength,
  };
}

export function shouldUseFallbackOperation(
  currentOperation: UpdateCenterStatus["lastOperation"],
  fallbackOperation: NonNullable<UpdateCenterStatus["lastOperation"]>,
): boolean {
  if (!currentOperation) return true;
  if (currentOperation.id === fallbackOperation.id) return false;
  return Date.parse(currentOperation.requestedAt) < Date.parse(fallbackOperation.requestedAt);
}

export function labelAutoApply(policy: AutoApplyPolicy): string {
  return {
    none: "只检查",
    patch: "自动 patch",
    minor: "自动 minor/patch",
    all: "自动全部版本",
  }[policy];
}

export function labelAction(action: UpdateAction): string {
  return {
    check: "检查更新",
    apply: "应用更新",
    rollback: "版本回退",
    set_auto_apply: "保存自动策略",
  }[action];
}

export function labelOperationStatus(status: UpdateOperationStatus): string {
  return {
    queued: "排队中",
    running: "执行中",
    succeeded: "成功",
    failed: "失败",
    needs_reconciliation: "需要人工协调",
  }[status];
}

export function isPendingOperation(status: UpdateOperationStatus | undefined): boolean {
  return status === "queued" || status === "running";
}

export function labelQueued(action: UpdateAction): string {
  return {
    check: "已提交检查请求。",
    apply: "已提交更新请求。",
    rollback: "已提交回退请求。",
    set_auto_apply: "已提交策略保存请求。",
  }[action];
}

export function labelError(error: string): string {
  if (error === "UNAUTHORIZED") return "请先登录。";
  if (error === "UPDATE_BLOCKED") return "更新通道存在阻塞项，请检查更新并处理阻塞原因。";
  if (error === "STATUS_SNAPSHOT_CHANGED") return "版本状态已变化，请重新读取后核对并确认。";
  if (error === "STATUS_SNAPSHOT_INVALID") return "状态快照未验证或已过期，请先检查更新。";
  if (error === "LEGACY_MUTATION_UNBOUND") return "当前 agent 状态版本过旧，不能提交变更请求。";
  if (error === "UPDATE_TARGET_UNVERIFIED") return "目标 Release 尚未通过 agent 身份校验。";
  if (error === "ROLLBACK_TARGET_UNVERIFIED") return "回退目标证据不完整，请先检查更新。";
  if (error === "UPDATE_TARGET_NOT_NEWER") return "当前已经是该版本或更新版本。";
  if (error === "UPDATE_TAG_REQUIRED") return "缺少目标 Release tag。";
  if (error === "ROLLBACK_TARGET_UNAVAILABLE") return "当前没有可回退版本。";
  if (error === "AUTO_APPLY_POLICY_REQUIRED") return "请选择自动更新策略。";
  if (error === "AUTO_APPLY_POLICY_UNCHANGED") return "自动更新策略没有变化。";
  if (error === "AUTO_APPLY_POLICY_UNSUPPORTED") return "当前仅允许只检查或自动 patch；minor/all 尚未开放。";
  return "操作提交失败。";
}

export function normalizedTag(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return "未知";
  return new Date(value).toLocaleString("zh-CN");
}

export function shortHash(value: string | null | undefined): string {
  if (!value) return "未验证";
  return `${value.slice(0, 15)}...${value.slice(-8)}`;
}
