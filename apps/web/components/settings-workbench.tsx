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
import { useMemo } from "react";
import type { AutoApplyPolicy, UpdateCenterStatus } from "@/lib/system/update-center";
import { getUpdateCenterHealth } from "@/lib/system/update-center-health";
import {
  labelAction,
  labelAutoApply,
  labelOperationStatus,
  normalizedTag,
  formatDateTime,
  shortHash,
} from "@/lib/system/update-center-ui";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Metric } from "@/components/ui/metric";
import { SectionSurface, Surface } from "@/components/ui/surface";
import { useUpdateCenterController } from "@/components/use-update-center-controller";

interface SettingsWorkbenchProps {
  userEmail: string;
  initialStatus: UpdateCenterStatus;
}

export function SettingsWorkbench({ userEmail, initialStatus }: SettingsWorkbenchProps) {
  const {
    status,
    autoApply,
    notice,
    isPending,
    mutationLocked,
    statusConclusionsUnverified,
    mutationStatusUnavailable,
    setAutoApply,
    refreshStatus,
    queueCheck,
    confirmApply,
    confirmRollback,
    confirmPolicySave,
  } = useUpdateCenterController(initialStatus);

  const statusTone = useMemo(() => getStatusTone(status), [status]);
  const StatusIcon = statusTone.icon;
  const releaseUrl = status.releaseUrl ?? "https://github.com/AreaSong/AreaForge/releases";

  return (
    <div className="af-content-grid-settings grid gap-5">
      <aside className="grid gap-5">
        <SectionSurface>
          <div className="flex items-center gap-3">
            <SlidersHorizontal className="h-5 w-5 text-teal-300" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-white">账号</h2>
            <p className="mt-1 text-sm text-zinc-400">{userEmail}</p>
            </div>
          </div>
        </SectionSurface>

        <SectionSurface>
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
        </SectionSurface>
      </aside>

      <SectionSurface>
        <div className="af-action-grid grid gap-4 border-b border-white/10 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-teal-300" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-white">版本中心</h2>
            </div>
            <p className="mt-2 text-sm text-zinc-400">{statusTone.label}</p>
          </div>
          <Button
            variant="secondary"
            size="lg"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            onClick={refreshStatus}
            type="button"
          >
            <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            重新读取
          </Button>
        </div>

        <div className="af-metric-grid-four mt-5 grid gap-3">
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
          <div className="af-action-grid mt-5 grid gap-3 rounded-md border border-amber-300/20 bg-amber-300/[0.06] p-4">
            <div>
              <p className="text-sm font-medium text-amber-100">当前结论不可用于更新或回退</p>
              <p className="mt-1 text-sm leading-6 text-zinc-400">重新读取只会获取现有状态；提交检查后，agent 才会重新验证版本结论。</p>
            </div>
            <Button
              variant="primary"
              size="lg"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-amber-300 px-4 text-sm font-medium text-[#17130a] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending || mutationLocked}
              onClick={queueCheck}
              type="button"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              检查更新
            </Button>
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

        <div className="af-action-grid mt-5 grid gap-3">
          <label className="grid gap-2 text-sm text-zinc-300">
            <span>自动更新策略</span>
            <Select
              className="h-11"
              disabled={isPending || mutationStatusUnavailable}
              onChange={(event) => setAutoApply(event.target.value as AutoApplyPolicy)}
              value={autoApply}
            >
              <option value="none">只检查</option>
              <option value="patch">自动 patch</option>
              {autoApply !== "none" && autoApply !== "patch" ? <option value={autoApply}>当前策略：{labelAutoApply(autoApply)}（兼容只读）</option> : null}
            </Select>
          </label>
          <Button
            variant="primary"
            size="lg"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 text-sm font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending || mutationStatusUnavailable || autoApply === status.autoApply}
            onClick={confirmPolicySave}
            type="button"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            保存策略
          </Button>
        </div>

        <div className="af-metric-grid-four mt-5 grid gap-3">
          {statusConclusionsUnverified ? null : (
            <Button
              variant="secondary"
              size="lg"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={queueCheck}
              type="button"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              检查更新
            </Button>
          )}
          <Button
            variant={statusConclusionsUnverified ? "secondary" : "primary"}
            size="lg"
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${statusConclusionsUnverified ? "border border-white/10 text-zinc-400" : "bg-teal-400 text-[#071011]"}`}
            disabled={isPending || mutationStatusUnavailable || !status.latestVersion || !status.updateAvailable}
            onClick={confirmApply}
            type="button"
          >
            <UploadCloud className="h-4 w-4" aria-hidden="true" />
            应用更新
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${statusConclusionsUnverified ? "border-white/10 text-zinc-400" : "border-amber-300/30 text-amber-100 hover:bg-amber-300/10"}`}
            disabled={isPending || mutationStatusUnavailable || !status.rollback.available}
            onClick={confirmRollback}
            type="button"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            版本回退
          </Button>
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
          <Surface tone="raised" padding="sm" className="mt-5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-medium text-white">最近操作：{labelAction(status.lastOperation.action)}</p>
              <span className={`rounded-md border px-2 py-1 text-xs ${operationBadge(status.lastOperation.status)}`}>
                {labelOperationStatus(status.lastOperation.status)}
              </span>
            </div>
            <p className="mt-2 text-zinc-400">{status.lastOperation.message ?? "等待 agent 回写结果。"}</p>
            {status.lastOperation.reasonCode ? <p className="mt-2 text-amber-100">原因代码：{status.lastOperation.reasonCode}</p> : null}
            {status.lastOperation.executionAttempted === null ? <p className="mt-2 text-rose-100">执行边界不确定，后续变更已阻塞，需要人工协调。</p> : null}
          </Surface>
        ) : null}

        {notice ? (
          <p className={`mt-4 text-sm ${noticeClass(notice.tone)}`}>{notice.text}</p>
        ) : null}
      </SectionSurface>
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
    <dl>
      <Metric
        icon={Icon}
        label={label}
        value={value}
        detail={sub}
        layout="tile"
        tone={muted ? "muted" : "accent"}
        valueSize="lg"
        className="rounded-[var(--af-radius-control)] border border-[var(--af-border)] [&_dd]:truncate [&_dd_span]:truncate"
      />
    </dl>
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

function noticeClass(tone: "info" | "success" | "danger"): string {
  return {
    info: "text-sky-100",
    success: "text-teal-100",
    danger: "text-rose-100",
  }[tone];
}
