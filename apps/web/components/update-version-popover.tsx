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

  async function refreshStatus() {
    setNotice(null);
    const response = await fetch("/api/system/update-status", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as { status?: UpdateCenterStatus; error?: string } | null;
    if (!response.ok || !body?.status) {
      setNotice({ tone: "danger", text: "状态刷新失败。" });
      return;
    }
    setStatus(body.status);
  }

  function queue(action: UpdateAction, options?: { tag?: string }) {
    setNotice(null);
    startTransition(async () => {
      const response = await fetch("/api/system/update-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...options }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setNotice({ tone: "danger", text: labelError(body?.error ?? "REQUEST_FAILED") });
        return;
      }
      setNotice({ tone: "success", text: labelQueued(action) });
      await refreshStatus();
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
        className={`inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition hover:bg-white/10 ${tone.buttonClass}`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ToneIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {normalizedTag(status.currentVersion)}
      </button>

      {open ? (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[min(calc(100vw-2rem),23rem)] rounded-lg border border-white/10 bg-[#111821] p-4 shadow-2xl shadow-black/50"
          id="update-version-popover"
        >
          <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <p className="text-sm font-medium text-zinc-300">当前版本</p>
              <p className="mt-3 text-3xl font-semibold text-white">{normalizedTag(status.currentVersion)}</p>
              <p className={`mt-2 text-sm ${tone.textClass}`}>{tone.label}</p>
            </div>
            <button
              aria-label="刷新版本状态"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={() => startTransition(refreshStatus)}
              title="刷新版本状态"
              type="button"
            >
              <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
          </div>

          <div className="mt-4 grid gap-2 text-sm">
            <InfoRow label="最新发布" value={status.latestVersion ? normalizedTag(status.latestVersion) : "未知"} />
            <InfoRow label="上次检查" value={formatDateTime(status.lastCheckedAt)} />
            <InfoRow label="更新策略" value={labelAutoApply(status.autoApply)} />
            <InfoRow label="回退状态" value={status.rollback.available ? (status.rollback.targetVersion ?? "可回退") : "不可用"} />
          </div>

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
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/10 px-2 text-xs text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={() => queue("check")}
              type="button"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              检查更新
            </button>
            <a
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/10 px-2 text-xs text-zinc-100 hover:bg-white/10"
              href={releaseUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              查看发布
            </a>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-teal-400 px-2 text-xs font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending || !status.latestVersion || !status.updateAvailable}
              onClick={confirmApply}
              type="button"
            >
              <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
              应用更新
            </button>
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-amber-300/30 px-2 text-xs text-amber-100 hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending || !status.rollback.available}
              onClick={confirmRollback}
              type="button"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              版本回退
            </button>
          </div>

          <Link
            className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-white/10 px-2 text-xs text-zinc-100 hover:bg-white/10"
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className="truncate text-right text-zinc-200">{value}</span>
    </div>
  );
}

function getTone(status: UpdateCenterStatus) {
  if (status.blocker) {
    return {
      icon: ShieldAlert,
      label: "更新通道需要处理阻塞项",
      buttonClass: "border-amber-300/30 text-amber-100",
      textClass: "text-amber-100",
    };
  }
  if (status.updateAvailable) {
    return {
      icon: UploadCloud,
      label: "发现可应用版本",
      buttonClass: "border-sky-300/30 text-sky-100",
      textClass: "text-sky-100",
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
  return "操作提交失败。";
}

function normalizedTag(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "未知";
  return new Date(value).toLocaleString("zh-CN");
}
