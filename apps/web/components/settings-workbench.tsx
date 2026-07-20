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
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { AutoApplyPolicy, UpdateAction, UpdateCenterStatus } from "@/lib/system/update-center";
import { getUpdateCenterHealth } from "@/lib/system/update-center-health";
import {
  isPendingOperation,
  labelAction,
  labelAutoApply,
  labelError,
  labelOperationStatus,
  labelQueued,
  mergeFallbackOperation,
  normalizedTag,
  formatDateTime,
  shortHash,
} from "@/lib/system/update-center-ui";
import {
  acknowledgeUpdateRequestIdempotencyKey,
  bindUpdateRequestIdempotencyRequest,
  buildUpdateRequestIdempotencyIntent,
  reuseUpdateRequestIdempotencyKey,
  settleUpdateRequestIdempotencyFromOperation,
  shouldAcknowledgeUpdateRequestAttempt,
} from "@/lib/system/update-request-idempotency";

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
  const pendingIdempotencyKeys = useRef(new Map<string, string>());

  const statusTone = useMemo(() => getStatusTone(status), [status]);
  const statusHealth = getUpdateCenterHealth(status);
  const statusConclusionsUnverified = statusHealth === "unknown" || statusHealth === "stale";
  const mutationStatusUnavailable = statusHealth === "blocked" || statusHealth === "unknown" || statusHealth === "stale";
  const StatusIcon = statusTone.icon;
  const releaseUrl = status.releaseUrl ?? "https://github.com/AreaSong/AreaForge/releases";
  const operationId = status.lastOperation?.id;
  const operationStatus = status.lastOperation?.status;

  useEffect(() => {
    if (!operationId || !isPendingOperation(operationStatus)) return;

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
          setAutoApply(body.status.autoApply);
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
  }, [operationId, operationStatus]);

  async function refreshStatus(options?: {
    clearNotice?: boolean;
    fallbackOperation?: UpdateCenterStatus["lastOperation"];
  }) {
    if (options?.clearNotice ?? true) setNotice(null);
    try {
      const response = await fetch("/api/system/update-status", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { status?: UpdateCenterStatus; error?: string } | null;
      if (!response.ok || !body?.status) {
        setNotice({ tone: "danger", text: labelError(body?.error ?? "STATUS_FAILED") });
        return;
      }
      settleUpdateRequestIdempotencyFromOperation(pendingIdempotencyKeys.current, body.status.lastOperation);
      setStatus(mergeFallbackOperation(body.status, options?.fallbackOperation ?? null));
      setAutoApply(body.status.autoApply);
    } catch {
      setNotice({ tone: "danger", text: "网络暂时不可用，状态未更新；请检查连接后重试。" });
    }
  }

  function queue(action: UpdateAction, options?: { tag?: string; autoApply?: AutoApplyPolicy }) {
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
    startTransition(async () => {
      const payload = action === "apply"
        ? { action, tag: options?.tag, confirmedSnapshotHash, idempotencyKey }
        : action === "set_auto_apply"
          ? { action, autoApply: options?.autoApply, confirmedSnapshotHash, idempotencyKey }
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

  function confirmPolicySave() {
    if (autoApply === status.autoApply) return;
    if (!window.confirm(`确认将自动更新策略改为“${labelAutoApply(autoApply)}”？`)) return;
    queue("set_auto_apply", { autoApply });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
      <aside className="grid gap-5">
        <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="h-5 w-5 text-teal-300" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-white">账号</h2>
            <p className="mt-1 text-sm text-zinc-400">{userEmail}</p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <div className="flex items-center gap-3">
            <StatusIcon className={`h-5 w-5 ${statusTone.iconClass}`} aria-hidden="true" />
            <div>
              <p className="text-sm text-zinc-400">当前版本</p>
              <p className="mt-1 text-3xl font-semibold text-white">{normalizedTag(status.currentVersion)}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-2 text-sm">
            <KeyValue label="部署模式" value={labelDeployMode(status.deployMode)} />
            <KeyValue label="自动策略" value={labelAutoApply(status.autoApply)} />
            <KeyValue label="签名校验" value={status.signatureRequired ? "开启" : "关闭"} />
            <KeyValue label="状态读取" value={formatDateTime(status.statusUpdatedAt)} />
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
            <p className="mt-2 text-sm text-zinc-400">{statusTone.label}</p>
          </div>
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            onClick={() => startTransition(refreshStatus)}
            type="button"
          >
            <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            重新读取
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatusTile
            icon={GitBranch}
            label="最新 Release"
            muted={statusConclusionsUnverified}
            sub={statusConclusionsUnverified ? "检查更新后确认" : formatDateTime(status.latestPublishedAt)}
            value={statusConclusionsUnverified ? "待验证" : status.latestVersion ? normalizedTag(status.latestVersion) : "未知"}
          />
          <StatusTile icon={Clock3} label="上次检查" value={formatDateTime(status.lastCheckedAt)} sub={status.requestQueueLength === null ? "队列未知" : `队列 ${status.requestQueueLength} 个`} />
          <StatusTile icon={RefreshCw} label="Timer" value={labelTimer(status)} sub="server agent" />
          <StatusTile
            icon={RotateCcw}
            label="回退"
            muted={statusConclusionsUnverified}
            sub={statusConclusionsUnverified ? "检查更新后确认" : status.rollback.targetVersion ?? "暂无记录"}
            value={statusConclusionsUnverified ? "待验证" : status.rollback.available ? "可用" : "不可用"}
          />
        </div>

        {statusConclusionsUnverified ? (
          <div className="mt-5 flex flex-col gap-3 rounded-md border border-amber-300/20 bg-amber-300/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-amber-100">当前结论不可用于更新或回退</p>
              <p className="mt-1 text-sm leading-6 text-zinc-400">重新读取只会获取现有状态；提交检查后，agent 才会重新验证版本结论。</p>
            </div>
            <button
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-amber-300 px-4 text-sm font-medium text-[#17130a] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={() => queue("check")}
              type="button"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              检查更新
            </button>
          </div>
        ) : null}

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
              className="h-11 rounded-md border border-white/10 bg-[#151a20] px-3 text-sm text-white outline-none focus:border-teal-300/70"
              disabled={isPending || mutationStatusUnavailable}
              onChange={(event) => setAutoApply(event.target.value as AutoApplyPolicy)}
              value={autoApply}
            >
              <option value="none">只检查</option>
              <option value="patch">自动 patch</option>
              {autoApply !== "none" && autoApply !== "patch" ? <option value={autoApply}>当前策略：{labelAutoApply(autoApply)}（兼容只读）</option> : null}
            </select>
          </label>
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 text-sm font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending || mutationStatusUnavailable || autoApply === status.autoApply}
            onClick={confirmPolicySave}
            type="button"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            保存策略
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {statusConclusionsUnverified ? null : (
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={() => queue("check")}
              type="button"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              检查更新
            </button>
          )}
          <button
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${statusConclusionsUnverified ? "border border-white/10 text-zinc-400" : "bg-teal-400 text-[#071011]"}`}
            disabled={isPending || mutationStatusUnavailable || !status.latestVersion || !status.updateAvailable}
            onClick={confirmApply}
            type="button"
          >
            <UploadCloud className="h-4 w-4" aria-hidden="true" />
            应用更新
          </button>
          <button
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${statusConclusionsUnverified ? "border-white/10 text-zinc-400" : "border-amber-300/30 text-amber-100 hover:bg-amber-300/10"}`}
            disabled={isPending || mutationStatusUnavailable || !status.rollback.available}
            onClick={confirmRollback}
            type="button"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            版本回退
          </button>
          <a
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
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
            <p className="mt-2 text-zinc-400">{status.lastOperation.message ?? "等待 agent 回写结果。"}</p>
            {status.lastOperation.reasonCode ? <p className="mt-2 text-amber-100">原因代码：{status.lastOperation.reasonCode}</p> : null}
            {status.lastOperation.executionAttempted === null ? <p className="mt-2 text-rose-100">执行边界不确定，后续变更已阻塞，需要人工协调。</p> : null}
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
  muted = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-[#151a20] p-4">
      <Icon className={`h-5 w-5 ${muted ? "text-zinc-500" : "text-teal-300"}`} aria-hidden="true" />
      <p className="mt-3 text-xs text-zinc-400">{label}</p>
      <p className={`mt-1 truncate text-lg font-semibold ${muted ? "text-zinc-300" : "text-white"}`}>{value}</p>
      <p className="mt-1 truncate text-xs text-zinc-400">{sub}</p>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2">
      <span className="text-zinc-400">{label}</span>
      <span className="truncate text-right text-zinc-200">{value}</span>
    </div>
  );
}

function getStatusTone(status: UpdateCenterStatus) {
  const health = getUpdateCenterHealth(status);
  if (health === "blocked") {
    return {
      icon: ShieldAlert,
      iconClass: "text-amber-300",
      label: "更新通道需要处理阻塞项。",
    };
  }
  if (health === "update_available") {
    return {
      icon: UploadCloud,
      iconClass: "text-sky-300",
      label: "发现可应用版本。",
    };
  }
  if (health === "unknown") {
    return {
      icon: Clock3,
      iconClass: "text-amber-300",
      label: "版本状态尚未验证，请检查更新。",
    };
  }
  if (health === "stale") {
    return {
      icon: Clock3,
      iconClass: "text-amber-300",
      label: "版本状态已过期，请检查更新。",
    };
  }
  return {
    icon: CheckCircle2,
    iconClass: "text-teal-300",
    label: "版本状态快照可用。",
  };
}

function labelDeployMode(mode: UpdateCenterStatus["deployMode"]): string {
  return {
    release: "GitHub Release",
    local_build: "服务器本地构建",
    unknown: "未知",
  }[mode];
}

function labelTimer(status: UpdateCenterStatus): string {
  if (status.timerActive === true) return "运行中";
  if (status.timerActive === false) return "未运行";
  return "未知";
}

function operationBadge(status: NonNullable<UpdateCenterStatus["lastOperation"]>["status"]): string {
  return {
    queued: "border-sky-300/20 text-sky-100",
    running: "border-amber-300/20 text-amber-100",
    succeeded: "border-teal-300/20 text-teal-100",
    failed: "border-rose-300/20 text-rose-100",
    needs_reconciliation: "border-rose-300/30 bg-rose-300/10 text-rose-100",
  }[status];
}

function noticeClass(tone: NoticeTone): string {
  return {
    info: "text-sky-100",
    success: "text-teal-100",
    danger: "text-rose-100",
  }[tone];
}

