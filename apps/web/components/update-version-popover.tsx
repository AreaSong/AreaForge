"use client";

import { Button, IconButton } from "@/components/ui/button";
import { useUpdateCenterController } from "@/components/use-update-center-controller";
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
import { useEffect, useMemo, useRef, useState } from "react";
import type { UpdateCenterStatus } from "@/lib/system/update-center";
import { getUpdateCenterHealth } from "@/lib/system/update-center-health";
import {
  labelAction,
  labelAutoApply,
  labelOperationStatus,
  normalizedTag,
  formatDateTime,
  shortHash,
} from "@/lib/system/update-center-ui";

interface UpdateVersionPopoverProps {
  initialStatus: UpdateCenterStatus;
}

export function UpdateVersionPopover({ initialStatus }: UpdateVersionPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const {
    status,
    notice,
    isPending,
    mutationLocked,
    statusConclusionsUnverified,
    mutationStatusUnavailable,
    refreshStatus,
    queueCheck,
    confirmApply,
    confirmRollback,
  } = useUpdateCenterController(initialStatus, {
    pollingEnabled: open,
    statusReadNetworkFailureMessage: "网络暂时不可用，请稍后重试。",
    statusReadFailureMessage: "状态重新读取失败。",
  });
  const tone = useMemo(() => getTone(status), [status]);
  const ToneIcon = tone.icon;
  const releaseUrl = status.releaseUrl ?? "https://github.com/AreaSong/AreaForge/releases";

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

  return (
    <div className="relative" ref={popoverRef}>
      <Button
        aria-controls="update-version-popover"
        aria-expanded={open}
        className={`inline-flex h-11 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition hover:bg-white/10 sm:h-8 ${tone.buttonClass}`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ToneIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {normalizedTag(status.currentVersion)}
      </Button>

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
            <IconButton
              label="重新读取版本状态"
              aria-label="重新读取版本状态"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={refreshStatus}
              title="重新读取版本状态"
              type="button"
            >
              <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            </IconButton>
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
              <Button
                className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-amber-300 px-2 text-xs font-medium text-[#17130a] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending || mutationLocked}
                onClick={queueCheck}
                type="button"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                检查更新
              </Button>
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
              <Button
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-2 text-xs text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending || mutationLocked}
                onClick={queueCheck}
                type="button"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                检查更新
              </Button>
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
            <Button
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${statusConclusionsUnverified ? "border border-white/10 text-zinc-400" : "bg-teal-400 text-[#071011]"}`}
              disabled={isPending || mutationStatusUnavailable || !status.latestVersion || !status.updateAvailable}
              onClick={confirmApply}
              type="button"
            >
              <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
              应用更新
            </Button>
            <Button
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60 ${statusConclusionsUnverified ? "border-white/10 text-zinc-400" : "border-amber-300/30 text-amber-100 hover:bg-amber-300/10"}`}
              disabled={isPending || mutationStatusUnavailable || !status.rollback.available}
              onClick={confirmRollback}
              type="button"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              版本回退
            </Button>
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
