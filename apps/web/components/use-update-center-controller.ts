"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  isRetryableSystemUpdateError,
  isSystemUpdateNetworkError,
  readSystemUpdateStatus,
  startSystemUpdateStatusPolling,
  submitSystemUpdateRequest,
  systemUpdateErrorCode,
} from "@/lib/api/system-update";
import type { AutoApplyPolicy, UpdateAction, UpdateCenterStatus } from "@/lib/system/update-center";
import {
  createUpdateCenterCoordinatorState,
  isUpdateCenterMutationLocked,
  reduceUpdateCenterCoordinator,
  selectUpdateCenterStatus,
  shouldContinueTargetOperation,
} from "@/lib/system/update-center-coordinator";
import { getUpdateCenterHealth } from "@/lib/system/update-center-health";
import { labelAutoApply, labelError, labelQueued, normalizedTag } from "@/lib/system/update-center-ui";
import {
  acknowledgeUpdateRequestIdempotencyKey,
  bindUpdateRequestIdempotencyRequest,
  buildUpdateRequestIdempotencyIntent,
  reuseUpdateRequestIdempotencyKey,
  settleUpdateRequestIdempotencyFromOperation,
  shouldAcknowledgeUpdateRequestAttempt,
} from "@/lib/system/update-request-idempotency";

export type UpdateCenterNotice = {
  tone: "info" | "success" | "danger";
  text: string;
};

interface QueueOptions {
  tag?: string;
  autoApply?: AutoApplyPolicy;
}

interface UpdateCenterControllerOptions {
  pollingEnabled?: boolean;
  statusReadFailureMessage?: string;
  statusReadNetworkFailureMessage?: string;
}

interface SequencedUpdateStatus {
  sequence: number;
  status: UpdateCenterStatus;
}

export function useUpdateCenterController(
  initialStatus: UpdateCenterStatus,
  controllerOptions: UpdateCenterControllerOptions = {},
) {
  const [coordinator, dispatch] = useReducer(
    reduceUpdateCenterCoordinator,
    initialStatus,
    createUpdateCenterCoordinatorState,
  );
  const [notice, setNotice] = useState<UpdateCenterNotice | null>(null);
  const [activeReadCount, setActiveReadCount] = useState(0);
  const pendingIdempotencyKeys = useRef(new Map<string, string>());
  const readSequenceRef = useRef(0);
  const acceptedReadSequenceRef = useRef(0);
  const lastPollSequenceRef = useRef(0);
  const mutationLockRef = useRef(Boolean(
    initialStatus.lastOperation && (initialStatus.lastOperation.status === "queued" || initialStatus.lastOperation.status === "running"),
  ));
  const status = useMemo(() => selectUpdateCenterStatus(coordinator), [coordinator]);
  const targetOperationId = coordinator.targetOperation?.id;
  const pollingEnabled = controllerOptions.pollingEnabled ?? true;

  useEffect(() => {
    mutationLockRef.current = isUpdateCenterMutationLocked(coordinator);
  }, [coordinator]);

  const acceptStatus = useCallback((snapshot: SequencedUpdateStatus): boolean => {
    if (snapshot.sequence <= acceptedReadSequenceRef.current) return false;
    acceptedReadSequenceRef.current = snapshot.sequence;
    settleUpdateRequestIdempotencyFromOperation(
      pendingIdempotencyKeys.current,
      snapshot.status.lastOperation,
    );
    dispatch({ type: "read-status", ...snapshot });
    return true;
  }, []);

  const readSequencedStatus = useCallback(async (signal?: AbortSignal): Promise<SequencedUpdateStatus> => {
    const sequence = readSequenceRef.current + 1;
    readSequenceRef.current = sequence;
    return { sequence, status: await readSystemUpdateStatus(signal) };
  }, []);

  useEffect(() => {
    if (!pollingEnabled || !targetOperationId) return;
    return startSystemUpdateStatusPolling({
      readStatus: (signal) => {
        const promise = readSequencedStatus(signal);
        lastPollSequenceRef.current = readSequenceRef.current;
        return promise;
      },
      shouldContinue: (snapshot) => shouldContinueTargetOperation(snapshot.status, targetOperationId),
      onStatus: acceptStatus,
      onError: (error) => {
        if (isRetryableSystemUpdateError(error)) return;
        if (lastPollSequenceRef.current !== readSequenceRef.current) return;
        setNotice({ tone: "danger", text: labelError(error.code) });
      },
      onExhausted: () => {
        if (lastPollSequenceRef.current !== readSequenceRef.current) return;
        setNotice({
          tone: "danger",
          text: "状态轮询已达到重试上限；目标操作仍保持锁定，请手动重新读取状态。",
        });
      },
    });
  }, [acceptStatus, pollingEnabled, readSequencedStatus, targetOperationId]);

  const refreshStatus = useCallback(async (clearNotice = true) => {
    if (clearNotice) setNotice(null);
    setActiveReadCount((current) => current + 1);
    const sequence = readSequenceRef.current + 1;
    readSequenceRef.current = sequence;
    try {
      const nextStatus = await readSystemUpdateStatus();
      acceptStatus({ sequence, status: nextStatus });
    } catch (error) {
      if (sequence === readSequenceRef.current && sequence > acceptedReadSequenceRef.current) {
        setNotice({
          tone: "danger",
          text: isSystemUpdateNetworkError(error)
            ? controllerOptions.statusReadNetworkFailureMessage ?? "网络暂时不可用，状态未更新；请检查连接后重试。"
            : controllerOptions.statusReadFailureMessage ?? labelError(systemUpdateErrorCode(error, "STATUS_FAILED")),
        });
      }
    } finally {
      setActiveReadCount((current) => Math.max(0, current - 1));
    }
  }, [acceptStatus, controllerOptions.statusReadFailureMessage, controllerOptions.statusReadNetworkFailureMessage]);

  async function queue(action: UpdateAction, options?: QueueOptions) {
    if (mutationLockRef.current) return;
    const health = getUpdateCenterHealth(status);
    if (action !== "check" && (health === "blocked" || health === "unknown" || health === "stale")) {
      setNotice({
        tone: "danger",
        text: status.blocker ?? "当前版本状态未验证或已过期，请先检查更新后再提交变更请求。",
      });
      return;
    }
    const confirmedSnapshotHash = status.snapshotHash;
    if (action !== "check" && !confirmedSnapshotHash) {
      setNotice({ tone: "danger", text: "当前状态快照未通过校验，请先检查更新。" });
      return;
    }
    const requestIntent = buildUpdateRequestIdempotencyIntent({
      action,
      tag: options?.tag,
      autoApply: options?.autoApply === "none" || options?.autoApply === "patch"
        ? options.autoApply
        : undefined,
      confirmedSnapshotHash,
    });
    const idempotencyKey = reuseUpdateRequestIdempotencyKey(
      pendingIdempotencyKeys.current,
      requestIntent,
      () => crypto.randomUUID(),
    );
    setNotice(null);
    mutationLockRef.current = true;
    dispatch({ type: "submit-started" });
    const payload = action === "apply"
      ? { action, tag: options?.tag, confirmedSnapshotHash: confirmedSnapshotHash ?? undefined, idempotencyKey }
      : action === "set_auto_apply"
        ? { action, autoApply: options?.autoApply, confirmedSnapshotHash: confirmedSnapshotHash ?? undefined, idempotencyKey }
        : confirmedSnapshotHash
          ? { action, confirmedSnapshotHash, idempotencyKey }
          : { action, idempotencyKey };
    try {
      const result = await submitSystemUpdateRequest(payload);
      const queuedOperation = result.request;
      if (queuedOperation?.id) {
        bindUpdateRequestIdempotencyRequest(requestIntent, idempotencyKey, queuedOperation.id);
        dispatch({ type: "request-queued", operation: queuedOperation });
      }
      if (shouldAcknowledgeUpdateRequestAttempt({
        responseOk: result.responseOk,
        responseStatus: result.responseStatus,
        responseBody: result.responseBody,
      })) {
        acknowledgeUpdateRequestIdempotencyKey(pendingIdempotencyKeys.current, requestIntent, idempotencyKey);
      }
      if (!result.responseOk) {
        if (!queuedOperation) {
          mutationLockRef.current = false;
          dispatch({ type: "submit-failed" });
        }
        setNotice({ tone: "danger", text: labelError(result.errorCode ?? "REQUEST_FAILED") });
        if (queuedOperation) void refreshStatus(false);
        return;
      }
      if (!queuedOperation) {
        mutationLockRef.current = false;
        dispatch({ type: "submit-failed" });
        setNotice({ tone: "danger", text: "请求响应不完整，请先重新读取状态，不要重复提交。" });
        return;
      }
      await refreshStatus(false);
      setNotice(queuedOperation.publishDurability === "uncertain"
        ? { tone: "danger", text: queuedOperation.message ?? "请求可能已入队，请先重新读取状态，不要重复提交。" }
        : { tone: "success", text: labelQueued(action) });
    } catch (error) {
      mutationLockRef.current = false;
      dispatch({ type: "submit-failed" });
      setNotice({
        tone: "danger",
        text: isSystemUpdateNetworkError(error)
          ? "网络暂时不可用，请重新读取状态后再提交请求。"
          : "请求响应不完整，请先重新读取状态，不要重复提交。",
      });
    }
  }

  function confirmApply() {
    const tag = status.latestVersion ? normalizedTag(status.latestVersion) : undefined;
    if (!tag || !status.updateAvailable) {
      setNotice({ tone: "danger", text: "当前没有可应用的新版本。" });
      return;
    }
    if (!window.confirm(`确认提交更新请求：${tag}？`)) return;
    void queue("apply", { tag });
  }

  function confirmRollback() {
    if (!status.rollback.available) {
      setNotice({ tone: "danger", text: "当前没有可回退版本。" });
      return;
    }
    if (!window.confirm(`确认提交回退请求：${status.rollback.targetVersion ?? "上一版本"}？`)) return;
    void queue("rollback");
  }

  function confirmPolicySave() {
    if (!coordinator.policyDirty) return;
    if (!window.confirm(`确认将自动更新策略改为“${labelAutoApply(coordinator.policyDraft)}”？`)) return;
    void queue("set_auto_apply", { autoApply: coordinator.policyDraft });
  }

  const health = getUpdateCenterHealth(status);
  const mutationLocked = isUpdateCenterMutationLocked(coordinator);
  return {
    status,
    autoApply: coordinator.policyDraft,
    notice,
    isPending: coordinator.submitting || activeReadCount > 0,
    mutationLocked,
    statusConclusionsUnverified: health === "unknown" || health === "stale",
    mutationStatusUnavailable: mutationLocked || health === "blocked" || health === "unknown" || health === "stale",
    setAutoApply: (policy: AutoApplyPolicy) => dispatch({ type: "change-policy", policy }),
    refreshStatus: () => void refreshStatus(),
    queueCheck: () => void queue("check"),
    confirmApply,
    confirmRollback,
    confirmPolicySave,
  };
}

export type UpdateCenterController = ReturnType<typeof useUpdateCenterController>;
