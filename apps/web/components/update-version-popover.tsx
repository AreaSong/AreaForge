"use client";

import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldAlert,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { UpdateAction, UpdateCenterStatus } from "@/lib/system/update-center";
import { getUpdateCenterHealth } from "@/lib/system/update-center-health";
import {
  acknowledgeUpdateRequestIdempotencyKey,
  bindUpdateRequestIdempotencyRequest,
  buildUpdateRequestIdempotencyIntent,
  reuseUpdateRequestIdempotencyKey,
  settleUpdateRequestIdempotencyFromOperation,
  shouldAcknowledgeUpdateRequestAttempt,
} from "@/lib/system/update-request-idempotency";

interface UpdateVersionPopoverProps {
  initialStatus: UpdateCenterStatus;
}

type NoticeTone = "success" | "danger";

export function UpdateVersionPopover({ initialStatus }: UpdateVersionPopoverProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const popoverRef = useRef<HTMLDivElement>(null);
  const pendingIdempotencyKeys = useRef(new Map<string, string>());
  const tone = useMemo(() => getTone(status), [status]);
  const statusHealth = getUpdateCenterHealth(status);
  const statusConclusionsUnverified = statusHealth === "unknown" || statusHealth === "stale";
  const mutationStatusUnavailable = statusHealth === "blocked" || statusHealth === "unknown" || statusHealth === "stale";
  const ToneIcon = tone.icon;
  const releaseUrl = status.releaseUrl ?? "https://github.com/AreaSong/AreaForge/releases";
  const operationId = status.lastOperation?.id;
  const operationStatus = status.lastOperation?.status;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!popoverRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !operationId || !isPendingOperation(operationStatus)) return;

    let cancelled = false;
    let polls = 0;
    let timer: number | undefined;
    const poll = async () => {
      if (cancelled || polls >= 12) return;
      polls += 1;
      try {
        const response = await fetch("/api/system/update-status", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { status?: UpdateCenterStatus } | null;
        if (!cancelled && response.ok && body?.status) {
          settleUpdateRequestIdempotencyFromOperation(pendingIdempotencyKeys.current, body.status.lastOperation);
          setStatus(body.status);
          if (isPendingOperation(body.status.lastOperation?.status)) {
            timer = window.setTimeout(poll, 5_000);
          }
        }
      } catch {
        if (!cancelled && polls < 12) timer = window.setTimeout(poll, 5_000);
      }
    };

    timer = window.setTimeout(poll, 5_000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [open, operationId, operationStatus]);

  async function refreshStatus(options?: {
    clearNotice?: boolean;
    fallbackOperation?: UpdateCenterStatus["lastOperation"];
  }) {
    if (options?.clearNotice ?? true) setNotice(null);
    try {
      const response = await fetch("/api/system/update-status", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { status?: UpdateCenterStatus; error?: string } | null;
      if (!response.ok || !body?.status) {
        setNotice({ tone: "danger", text: "状态重新读取失败。" });
        return;
      }
      settleUpdateRequestIdempotencyFromOperation(pendingIdempotencyKeys.current, body.status.lastOperation);
      setStatus(mergeFallbackOperation(body.status, options?.fallbackOperation ?? null));
    } catch {
      setNotice({ tone: "danger", text: "网络暂时不可用，请稍后重试。" });
    }
  }

  function queue(action: UpdateAction, options?: { tag?: string }) {
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
      confirmedSnapshotHash,
    });
    const idempotencyKey = reuseUpdateRequestIdempotencyKey(
      pendingIdempotencyKeys.current,
      requestIntent,
      () => crypto.randomUUID(),
    );
    setNotice(null);
    startTransition(async () => {
      const payload = action === "apply"
        ? { action, tag: options?.tag, confirmedSnapshotHash, idempotencyKey }
        : confirmedSnapshotHash
          ? { action, confirmedSnapshotHash, idempotencyKey }
          : { action, idempotencyKey };
      try {
        const response = await fetch("/api/system/update-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await response.json().catch(() => null)) as {
          request?: NonNullable<UpdateCenterStatus["lastOperation"]>;
          error?: string;
        } | null;
        const queuedOperation = body?.request ?? null;
        if (queuedOperation?.id) {
          bindUpdateRequestIdempotencyRequest(requestIntent, idempotencyKey, queuedOperation.id);
        }
        if (shouldAcknowledgeUpdateRequestAttempt({
          responseOk: response.ok,
          responseStatus: response.status,
          responseBody: body,
        })) {
          acknowledgeUpdateRequestIdempotencyKey(pendingIdempotencyKeys.current, requestIntent, idempotencyKey);
        }
        if (!response.ok) {
          setNotice({ tone: "danger", text: labelError(body?.error ?? "REQUEST_FAILED") });
          return;
        }
        if (!queuedOperation) {
          setNotice({ tone: "danger", text: "请求响应不完整，请先重新读取状态，不要重复提交。" });
          return;
        }
        setStatus((current) => mergeFallbackOperation(current, queuedOperation));
        await refreshStatus({ clearNotice: false, fallbackOperation: queuedOperation });
        setNotice(queuedOperation.publishDurability === "uncertain"
          ? { tone: "danger", text: queuedOperation.message ?? "请求可能已入队，请先重新读取状态，不要重复提交。" }
          : { tone: "success", text: labelQueued(action) });
      } catch {
        setNotice({ tone: "danger", text: "网络暂时不可用，请重新读取状态后再提交请求。" });
      }
    });
  }

  function confirmApply() {
    const tag = status.latestVersion ? normalizedTag(status.latestVersion) : undefined;
    if (!tag || !status.updateAvailable) {
      setNotice({ tone: "danger", text: "当前没有可应用的新版本。" });
      return;
    }
    if (!window.confirm(`确认提交更新请求：${tag}？`)) return;
    queue("apply", { tag });
  }

  function confirmRollback() {
    if (!status.rollback.available) {
      setNotice({ tone: "danger", text: "当前没有可回退版本。" });
      return;
    }
    if (!window.confirm(`确认提交回退请求：${status.rollback.targetVersion ?? "上一版本"}？`)) return;
    queue("rollback");
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        aria-controls="update-version-popover"
        aria-expanded={open}
        className={`inline-flex h-11 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition hover:bg-white/10 sm:h-8 ${tone.buttonClass}`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ToneIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {normalizedTag(status.currentVersion)}
      </button>

      {open ? (
        <div
          className="fixed inset-x-4 top-20 z-50 max-h-[calc(100dvh-6rem)] w-auto overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-[#111821] p-4 shadow-2xl shadow-black/50 sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-[calc(100dvh-5rem)] sm:w-[min(calc(100vw-2rem),23rem)]"
          id="update-version-popover"
        >
          <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <p className="text-sm font-medium text-zinc-300">当前版本</p>
              <p className="mt-3 text-3xl font-semibold text-white">{normalizedTag(status.currentVersion)}</p>
              <p className={`mt-2 text-sm ${tone.textClass}`}>{tone.label}</p>
            </div>
            <button
              aria-label="重新读取版本状态"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={() => startTransition(refreshStatus)}
              title="重新读取版本状态"
              type="button"
            >
              <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
          </div>

          <div className="mt-4 grid gap-2 text-sm">
            <InfoRow label="最新发布" muted={statusConclusionsUnverified} value={statusConclusionsUnverified ? "待验证" : status.latestVersion ? normalizedTag(status.latestVersion) : "未知"} />
            <InfoRow label="上次检查" value={formatDateTime(status.lastCheckedAt)} />
            <InfoRow label="更新策略" value={labelAutoApply(status.autoApply)} />
            <InfoRow label="回退状态" muted={statusConclusionsUnverified} value={statusConclusionsUnverified ? "待验证" : status.rollback.available ? (status.rollback.targetVersion ?? "可回退") : "不可用"} />
            <InfoRow label="状态快照" value={shortHash(status.snapshotHash)} />
          </div>

          {statusConclusionsUnverified ? (
            <div className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/[0.06] p-3">
              <p className="text-xs leading-5 text-zinc-400">重新读取只获取现有状态。检查更新后，agent 才会重新验证更新与回退结论。</p>
              <button
                className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-amber-300 px-2 text-xs font-medium text-[#17130a] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending}
                onClick={() => queue("check")}
                type="button"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                检查更新
              </button>
            </div>
          ) : null}

          {status.blocker ? (
            <div className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-50">
              <div className="mb-1 flex items-center gap-2 text-amber-100">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                <span>阻塞原因</span>
              </div>
              {status.blocker}
            </div>
          ) : null}

          {status.lastOperation ? (
            <div className="mt-4 rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs text-zinc-400">
              <div className="flex items-center gap-2 text-zinc-200">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{labelAction(status.lastOperation.action)}：{labelOperationStatus(status.lastOperation.status)}</span>
              </div>
              <p className="mt-2 max-h-10 overflow-hidden">{status.lastOperation.message ?? "等待 agent 回写结果。"}</p>
              {status.lastOperation.reasonCode ? <p className="mt-1 text-amber-100">原因：{status.lastOperation.reasonCode}</p> : null}
              {status.lastOperation.executionAttempted === null ? <p className="mt-1 text-rose-100">执行边界不确定，需要人工协调。</p> : null}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2">
            {statusConclusionsUnverified ? null : (
              <button
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-2 text-xs text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending}
                onClick={() => queue("check")}
                type="button"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                检查更新
              </button>
            )}
            <a
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-2 text-xs text-zinc-100 hover:bg-white/10"
              href={releaseUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              查看发布
            </a>
            <button
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${statusConclusionsUnverified ? "border border-white/10 text-zinc-400" : "bg-teal-400 text-[#071011]"}`}
              disabled={isPending || mutationStatusUnavailable || !status.latestVersion || !status.updateAvailable}
              onClick={confirmApply}
              type="button"
            >
              <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
              应用更新
            </button>
            <button
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60 ${statusConclusionsUnverified ? "border-white/10 text-zinc-400" : "border-amber-300/30 text-amber-100 hover:bg-amber-300/10"}`}
              disabled={isPending || mutationStatusUnavailable || !status.rollback.available}
              onClick={confirmRollback}
              type="button"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              版本回退
            </button>
          </div>

          <Link
            className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-white/10 px-2 text-xs text-zinc-100 hover:bg-white/10"
            href="/settings"
            onClick={() => setOpen(false)}
          >
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
            打开设置
          </Link>

          {notice ? (
            <p className={`mt-3 text-xs ${notice.tone === "success" ? "text-teal-100" : "text-rose-100"}`}>
              {notice.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className={`truncate text-right ${muted ? "text-zinc-500" : "text-zinc-200"}`}>{value}</span>
    </div>
  );
}

function mergeFallbackOperation(
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

function shouldUseFallbackOperation(
  currentOperation: UpdateCenterStatus["lastOperation"],
  fallbackOperation: NonNullable<UpdateCenterStatus["lastOperation"]>,
): boolean {
  if (!currentOperation) return true;
  if (currentOperation.id === fallbackOperation.id) return false;
  return Date.parse(currentOperation.requestedAt) < Date.parse(fallbackOperation.requestedAt);
}

function getTone(status: UpdateCenterStatus) {
  const health = getUpdateCenterHealth(status);
  if (health === "blocked") {
    return {
      icon: ShieldAlert,
      label: "更新通道需要处理阻塞项",
      buttonClass: "border-amber-300/30 text-amber-100",
      textClass: "text-amber-100",
    };
  }
  if (health === "update_available") {
    return {
      icon: UploadCloud,
      label: "发现可应用版本",
      buttonClass: "border-sky-300/30 text-sky-100",
      textClass: "text-sky-100",
    };
  }
  if (health === "unknown") {
    return {
      icon: Clock3,
      label: "版本状态尚未验证，请检查更新",
      buttonClass: "border-amber-300/30 text-amber-100",
      textClass: "text-amber-100",
    };
  }
  if (health === "stale") {
    return {
      icon: Clock3,
      label: "版本状态已过期，请检查更新",
      buttonClass: "border-amber-300/30 text-amber-100",
      textClass: "text-amber-100",
    };
  }
  return {
    icon: CheckCircle2,
    label: "已是最新版本",
    buttonClass: "border-teal-400/30 text-teal-100",
    textClass: "text-zinc-400",
  };
}

function labelAutoApply(policy: UpdateCenterStatus["autoApply"]): string {
  return {
    none: "只检查",
    patch: "自动 patch",
    minor: "自动 minor/patch",
    all: "自动全部版本",
  }[policy];
}

function labelAction(action: UpdateAction): string {
  return {
    check: "检查更新",
    apply: "应用更新",
    rollback: "版本回退",
    set_auto_apply: "保存自动策略",
  }[action];
}

function labelOperationStatus(status: NonNullable<UpdateCenterStatus["lastOperation"]>["status"]): string {
  return {
    queued: "排队中",
    running: "执行中",
    succeeded: "成功",
    failed: "失败",
    needs_reconciliation: "需要人工协调",
  }[status];
}

function isPendingOperation(status: NonNullable<UpdateCenterStatus["lastOperation"]>["status"] | undefined): boolean {
  return status === "queued" || status === "running";
}

function labelQueued(action: UpdateAction): string {
  return {
    check: "已提交检查请求。",
    apply: "已提交更新请求。",
    rollback: "已提交回退请求。",
    set_auto_apply: "已提交策略保存请求。",
  }[action];
}

function labelError(error: string): string {
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
  return "操作提交失败。";
}

function normalizedTag(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "未知";
  return new Date(value).toLocaleString("zh-CN");
}

function shortHash(value: string | null | undefined): string {
  if (!value) return "未验证";
  return `${value.slice(0, 15)}...${value.slice(-8)}`;
}
