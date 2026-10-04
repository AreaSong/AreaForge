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
import { Card, CardContent, CardHeader, CardTitle, SectionCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { Metric } from "@/components/ui/metric";
import { SectionHeader } from "@/components/ui/page";
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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr] xl:grid-cols-[320px_1fr]">
      {/* Left Column (Aside) */}
      <aside className="space-y-5">
        <Card variant="master" className="space-y-4">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-teal-300">当前账号</span>
              <Badge tone="success">有效会话</Badge>
            </div>
            <CardTitle className="text-base flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-teal-400" />
              <span className="truncate">{userEmail}</span>
            </CardTitle>
          </CardHeader>
        </Card>

        <Card variant="master" className="space-y-4">
          <CardHeader className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-teal-300">运行版本</span>
            <div className="flex items-center gap-3 pt-1">
              <StatusIcon className={`size-6 shrink-0 ${statusTone.iconClass}`} aria-hidden="true" />
              <div>
                <p className="text-2xl font-bold tracking-tight text-white">{normalizedTag(status.currentVersion)}</p>
                <p className="text-xs text-zinc-400">{statusTone.label}</p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-2.5 pt-0 text-xs">
            <KeyValue label="部署模式" value={labelDeployMode(status.deployMode)} />
            <KeyValue label="自动策略" value={labelAutoApply(status.autoApply)} />
            <KeyValue label="签名校验" value={status.signatureRequired ? "开启" : "关闭"} />
            <KeyValue label="状态读取" value={formatDateTime(status.statusUpdatedAt)} />
            <KeyValue label="状态快照" value={shortHash(status.snapshotHash)} />
          </CardContent>
        </Card>
      </aside>

      {/* Right Column (Main) */}
      <main className="space-y-6 min-w-0">
        <SectionCard variant="master" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <GitBranch className="size-4 text-teal-300" />
                <span>受控更新中心</span>
              </h2>
              <p className="mt-0.5 text-xs text-zinc-400">{statusTone.label}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={isPending}
              onClick={refreshStatus}
              type="button"
            >
              <RefreshCw className={`size-3.5 ${isPending ? "animate-spin" : ""}`} aria-hidden="true" />
              重新读取
            </Button>
          </div>

          <div className="af-metric-grid-four grid gap-3">
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
            <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-amber-100">当前结论不可用于更新或回退</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">重新读取只会获取现有状态；提交检查后，agent 才会重新验证版本结论。</p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isPending || mutationLocked}
                  onClick={queueCheck}
                  type="button"
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  检查更新
                </Button>
              </div>
            </div>
          ) : null}

          {status.blocker ? (
            <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-xs leading-relaxed text-amber-100 space-y-1.5">
              <div className="flex items-center gap-2 font-medium">
                <ShieldAlert className="size-4 text-amber-300" aria-hidden="true" />
                <span>阻塞原因</span>
              </div>
              <p>{status.blocker}</p>
            </div>
          ) : null}

          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
            <label className="block text-xs font-medium text-zinc-300">
              <span className="mb-1 block">自动更新策略</span>
              <Select
                className="h-10"
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
              size="sm"
              disabled={isPending || mutationStatusUnavailable || autoApply === status.autoApply}
              onClick={confirmPolicySave}
              type="button"
            >
              <Save className="size-3.5" aria-hidden="true" />
              保存策略
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/10">
            {statusConclusionsUnverified ? null : (
              <Button
                variant="secondary"
                disabled={isPending}
                onClick={queueCheck}
                type="button"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                检查更新
              </Button>
            )}
            <Button
              variant={statusConclusionsUnverified ? "secondary" : "primary"}
              disabled={isPending || mutationStatusUnavailable || !status.latestVersion || !status.updateAvailable}
              onClick={confirmApply}
              type="button"
            >
              <UploadCloud className="size-4" aria-hidden="true" />
              应用更新
            </Button>
            <Button
              variant="secondary"
              disabled={isPending || mutationStatusUnavailable || !status.rollback.available}
              onClick={confirmRollback}
              type="button"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              版本回退
            </Button>
            <a
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 text-sm font-medium text-zinc-100 hover:bg-white/10 transition-colors"
              href={releaseUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              查看发布
            </a>
          </div>

          {status.lastOperation ? (
            <Card variant="subtle" className="p-4 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="font-semibold text-white">最近操作：{labelAction(status.lastOperation.action)}</strong>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${operationBadge(status.lastOperation.status)}`}>
                  {labelOperationStatus(status.lastOperation.status)}
                </span>
              </div>
              <p className="text-zinc-400">{status.lastOperation.message ?? "等待 agent 回写结果。"}</p>
              {status.lastOperation.reasonCode ? <p className="text-amber-200">原因代码：{status.lastOperation.reasonCode}</p> : null}
              {status.lastOperation.executionAttempted === null ? <p className="text-rose-300">执行边界不确定，后续变更已阻塞，需要人工协调。</p> : null}
            </Card>
          ) : null}

          {notice ? (
            <p className={`text-xs ${noticeClass(notice.tone)}`}>{notice.text}</p>
          ) : null}
        </SectionCard>
      </main>
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
    <Card variant="subtle" className="p-3.5 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-zinc-400">
        <Icon className="size-3.5 text-teal-300" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <p className={`text-lg font-bold tracking-tight ${muted ? "text-zinc-500" : "text-white"}`}>
        {value}
      </p>
      <p className="text-[11px] text-zinc-500 truncate">{sub}</p>
    </Card>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-2">
      <span className="text-zinc-500">{label}</span>
      <span className="truncate text-right font-medium text-zinc-200">{value}</span>
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
    queued: "border-sky-300/20 text-sky-200 bg-sky-500/10",
    running: "border-amber-300/20 text-amber-200 bg-amber-500/10",
    succeeded: "border-teal-300/20 text-teal-200 bg-teal-500/10",
    failed: "border-rose-300/20 text-rose-200 bg-rose-500/10",
    needs_reconciliation: "border-rose-300/30 bg-rose-500/20 text-rose-100",
  }[status];
}

function noticeClass(tone: "info" | "success" | "danger"): string {
  return {
    info: "text-sky-200",
    success: "text-teal-200",
    danger: "text-rose-200",
  }[tone];
}
