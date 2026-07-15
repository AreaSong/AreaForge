"use client";

import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import type { AutoApplyPolicy, UpdateAction, UpdateCenterStatus } from "@/lib/system/update-center";

interface SettingsWorkbenchProps {
  userEmail: string;
  initialStatus: UpdateCenterStatus;
}

type NoticeTone = "info" | "success" | "danger";

export function SettingsWorkbench({ userEmail, initialStatus }: SettingsWorkbenchProps) {
  const [status, setStatus] = useState(initialStatus);
  const [autoApply, setAutoApply] = useState<AutoApplyPolicy>(initialStatus.autoApply);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const statusTone = useMemo(() => getStatusTone(status), [status]);
  const StatusIcon = statusTone.icon;
  const releaseUrl = status.releaseUrl ?? "https://github.com/AreaSong/AreaForge/releases";

  async function refreshStatus(options?: {
    clearNotice?: boolean;
    fallbackOperation?: UpdateCenterStatus["lastOperation"];
  }) {
    if (options?.clearNotice ?? true) setNotice(null);
    const response = await fetch("/api/system/update-status", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as { status?: UpdateCenterStatus; error?: string } | null;
    if (!response.ok || !body?.status) {
      setNotice({ tone: "danger", text: labelError(body?.error ?? "STATUS_FAILED") });
      return;
    }
    setStatus(mergeFallbackOperation(body.status, options?.fallbackOperation ?? null));
    setAutoApply(body.status.autoApply);
  }

  function queue(action: UpdateAction, options?: { tag?: string; autoApply?: AutoApplyPolicy }) {
    const confirmedSnapshotHash = status.snapshotHash;
    if (!confirmedSnapshotHash) {
      setNotice({ tone: "danger", text: "当前状态快照未通过校验，请先刷新版本状态。" });
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    setNotice(null);
    startTransition(async () => {
      const payload = action === "apply"
        ? { action, tag: options?.tag, confirmedSnapshotHash, idempotencyKey }
        : action === "set_auto_apply"
          ? { action, autoApply: options?.autoApply, confirmedSnapshotHash, idempotencyKey }
          : { action, confirmedSnapshotHash, idempotencyKey };
      const response = await fetch("/api/system/update-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as {
        request?: NonNullable<UpdateCenterStatus["lastOperation"]>;
        error?: string;
      } | null;
      if (!response.ok) {
        setNotice({ tone: "danger", text: labelError(body?.error ?? "REQUEST_FAILED") });
        return;
      }
      const queuedOperation = body?.request ?? null;
      if (queuedOperation) {
        setStatus((current) => mergeFallbackOperation(current, queuedOperation));
      }
      await refreshStatus({ clearNotice: false, fallbackOperation: queuedOperation });
      setNotice({ tone: "success", text: labelQueued(action) });
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
    <div className="grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
      <aside className="grid gap-5">
        <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="h-5 w-5 text-teal-300" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-white">账号</h2>
              <p className="mt-1 text-sm text-zinc-500">{userEmail}</p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <div className="flex items-center gap-3">
            <StatusIcon className={`h-5 w-5 ${statusTone.iconClass}`} aria-hidden="true" />
            <div>
              <p className="text-sm text-zinc-500">当前版本</p>
              <p className="mt-1 text-3xl font-semibold text-white">{normalizedTag(status.currentVersion)}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-2 text-sm">
            <KeyValue label="部署模式" value={labelDeployMode(status.deployMode)} />
            <KeyValue label="自动策略" value={labelAutoApply(status.autoApply)} />
            <KeyValue label="签名校验" value={status.signatureRequired ? "开启" : "关闭"} />
            <KeyValue label="状态刷新" value={formatDateTime(status.statusUpdatedAt)} />
            <KeyValue label="状态快照" value={shortHash(status.snapshotHash)} />
          </div>
        </section>
      </aside>

      <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
        <div className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-teal-300" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-white">版本中心</h2>
            </div>
            <p className="mt-2 text-sm text-zinc-500">{statusTone.label}</p>
          </div>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            onClick={() => startTransition(refreshStatus)}
            type="button"
          >
            <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            刷新
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatusTile icon={GitBranch} label="最新 Release" value={status.latestVersion ? normalizedTag(status.latestVersion) : "未知"} sub={formatDateTime(status.latestPublishedAt)} />
          <StatusTile icon={Clock3} label="上次检查" value={formatDateTime(status.lastCheckedAt)} sub={status.requestQueueLength === null ? "队列未知" : `队列 ${status.requestQueueLength} 个`} />
          <StatusTile icon={RefreshCw} label="Timer" value={labelTimer(status)} sub="server agent" />
          <StatusTile icon={RotateCcw} label="回退" value={status.rollback.available ? "可用" : "不可用"} sub={status.rollback.targetVersion ?? "暂无记录"} />
        </div>

        {status.blocker ? (
          <div className="mt-5 rounded-md border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-50">
            <div className="mb-2 flex items-center gap-2 text-amber-100">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              <span>阻塞原因</span>
            </div>
            {status.blocker}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <label className="grid gap-2 text-sm text-zinc-300">
            <span>自动更新策略</span>
            <select
              className="h-10 rounded-md border border-white/10 bg-[#151a20] px-3 text-sm text-white outline-none focus:border-teal-300/70"
              disabled={isPending}
              onChange={(event) => setAutoApply(event.target.value as AutoApplyPolicy)}
              value={autoApply}
            >
              <option value="none">只检查</option>
              <option value="patch">自动 patch</option>
              <option value="minor">自动 minor/patch</option>
              <option value="all">自动全部版本</option>
            </select>
          </label>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 text-sm font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending || autoApply === status.autoApply}
            onClick={() => queue("set_auto_apply", { autoApply })}
            type="button"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            保存策略
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            onClick={() => queue("check")}
            type="button"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            检查更新
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending || !status.latestVersion || !status.updateAvailable}
            onClick={confirmApply}
            type="button"
          >
            <UploadCloud className="h-4 w-4" aria-hidden="true" />
            应用更新
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-amber-300/30 px-3 text-sm text-amber-100 hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending || !status.rollback.available}
            onClick={confirmRollback}
            type="button"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            版本回退
          </button>
          <a
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
            href={releaseUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            查看发布
          </a>
        </div>

        {status.lastOperation ? (
          <div className="mt-5 rounded-md border border-white/10 bg-[#151a20] p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-medium text-white">最近操作：{labelAction(status.lastOperation.action)}</p>
              <span className={`rounded-md border px-2 py-1 text-xs ${operationBadge(status.lastOperation.status)}`}>
                {labelOperationStatus(status.lastOperation.status)}
              </span>
            </div>
            <p className="mt-2 text-zinc-500">{status.lastOperation.message ?? "等待 agent 回写结果。"}</p>
          </div>
        ) : null}

        {notice ? (
          <p className={`mt-4 text-sm ${noticeClass(notice.tone)}`}>{notice.text}</p>
        ) : null}
      </section>
    </div>
  );
}

function StatusTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-[#151a20] p-4">
      <Icon className="h-5 w-5 text-teal-300" aria-hidden="true" />
      <p className="mt-3 text-xs text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-white">{value}</p>
      <p className="mt-1 truncate text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2">
      <span className="text-zinc-500">{label}</span>
      <span className="truncate text-right text-zinc-200">{value}</span>
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

function getStatusTone(status: UpdateCenterStatus) {
  if (status.blocker) {
    return {
      icon: ShieldAlert,
      iconClass: "text-amber-300",
      label: "更新通道需要处理阻塞项。",
    };
  }
  if (status.updateAvailable) {
    return {
      icon: UploadCloud,
      iconClass: "text-sky-300",
      label: "发现可应用版本。",
    };
  }
  return {
    icon: CheckCircle2,
    iconClass: "text-teal-300",
    label: "当前版本处于稳定状态。",
  };
}

function labelDeployMode(mode: UpdateCenterStatus["deployMode"]): string {
  return {
    release: "GitHub Release",
    local_build: "服务器本地构建",
    unknown: "未知",
  }[mode];
}

function labelAutoApply(policy: AutoApplyPolicy): string {
  return {
    none: "只检查",
    patch: "自动 patch",
    minor: "自动 minor/patch",
    all: "自动全部版本",
  }[policy];
}

function labelTimer(status: UpdateCenterStatus): string {
  if (status.timerActive === true) return "运行中";
  if (status.timerActive === false) return "未运行";
  return "未知";
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
  }[status];
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
  if (error === "STATUS_SNAPSHOT_CHANGED") return "版本状态已变化，请刷新后重新核对并确认。";
  if (error === "STATUS_SNAPSHOT_INVALID") return "状态快照未通过校验，请刷新后重试。";
  if (error === "LEGACY_MUTATION_UNBOUND") return "当前 agent 状态版本过旧，不能提交变更请求。";
  if (error === "UPDATE_TARGET_UNVERIFIED") return "目标 Release 尚未通过 agent 身份校验。";
  if (error === "ROLLBACK_TARGET_UNVERIFIED") return "回退目标证据不完整，请先刷新检查。";
  if (error === "UPDATE_TARGET_NOT_NEWER") return "当前已经是该版本或更新版本。";
  if (error === "UPDATE_TAG_REQUIRED") return "缺少目标 Release tag。";
  if (error === "ROLLBACK_TARGET_UNAVAILABLE") return "当前没有可回退版本。";
  if (error === "AUTO_APPLY_POLICY_REQUIRED") return "请选择自动更新策略。";
  if (error === "AUTO_APPLY_POLICY_UNCHANGED") return "自动更新策略没有变化。";
  return "操作提交失败。";
}

function operationBadge(status: NonNullable<UpdateCenterStatus["lastOperation"]>["status"]): string {
  return {
    queued: "border-sky-300/20 text-sky-100",
    running: "border-amber-300/20 text-amber-100",
    succeeded: "border-teal-300/20 text-teal-100",
    failed: "border-rose-300/20 text-rose-100",
  }[status];
}

function noticeClass(tone: NoticeTone): string {
  return {
    info: "text-sky-100",
    success: "text-teal-100",
    danger: "text-rose-100",
  }[tone];
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
