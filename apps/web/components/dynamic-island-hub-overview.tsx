"use client";

import type React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  FileCheck2,
  Moon,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  Zap,
} from "lucide-react";
import { formatClockDuration } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { activitySourcePath } from "@/lib/navigation/activity-route";
import type { GlobalCommandAction } from "@/lib/navigation/command-palette";
import type {
  DynamicIslandActiveItem,
  DynamicIslandAuraTheme,
} from "./dynamic-island-types";

export function HubSupervisionOverview(props: {
  activeStates: readonly DynamicIslandActiveItem[];
  dominantState: DynamicIslandActiveItem;
  elapsedSeconds: number;
  isResuming: boolean;
  onDirectResume: (e?: React.MouseEvent) => void;
  onOpenRecovery?: () => void;
  onRetrySync?: () => void;
  onOpenAction?: (action: GlobalCommandAction) => void;
  onClose: () => void;
  auraTheme?: DynamicIslandAuraTheme;
}) {
  const {
    activeStates,
    dominantState,
    elapsedSeconds,
    isResuming,
    onDirectResume,
    onOpenRecovery,
    onRetrySync,
    onOpenAction,
    onClose,
    auraTheme,
  } = props;
  const realStates = activeStates.filter((s) => s.kind !== "idle");

  if (realStates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center text-xs">
        <Sparkles size={22} className="text-teal-400/60 mb-2 animate-pulse" />
        <div className="font-semibold text-zinc-200">督战系统一切就绪</div>
        <div className="mt-1 text-zinc-500 max-w-xs leading-relaxed">
          当前无活跃警报或阻塞事项，各项闭环均已归档。
        </div>
        <Link
          href="/today"
          onClick={onClose}
          className="mt-3 inline-flex h-7 items-center gap-1 rounded-md bg-white/5 px-3 font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <span>查看今日行动</span>
          <ArrowRight size={11} />
        </Link>
      </div>
    );
  }

  return (
    <div className="max-h-72 overflow-y-auto space-y-2 focus-scrollbar pr-0.5">
      {realStates.map((item) => (
        <OverviewStateCard
          key={item.id}
          item={item}
          dominantState={dominantState}
          elapsedSeconds={elapsedSeconds}
          isResuming={isResuming}
          onDirectResume={onDirectResume}
          onOpenRecovery={onOpenRecovery}
          onRetrySync={onRetrySync}
          onOpenAction={onOpenAction}
          onClose={onClose}
          auraTheme={auraTheme}
        />
      ))}
    </div>
  );
}

export function OverviewStateCard(props: {
  item: DynamicIslandActiveItem;
  dominantState?: DynamicIslandActiveItem;
  elapsedSeconds: number;
  isResuming: boolean;
  onDirectResume: (e?: React.MouseEvent) => void;
  onOpenRecovery?: () => void;
  onRetrySync?: () => void;
  onOpenAction?: (action: GlobalCommandAction) => void;
  onClose: () => void;
  auraTheme?: DynamicIslandAuraTheme;
}) {
  const {
    item,
    elapsedSeconds,
    isResuming,
    onDirectResume,
    onOpenRecovery,
    onRetrySync,
    onOpenAction,
    onClose,
  } = props;
  const session = item.session;

  if (item.kind === "live_session_running" && session) {
    return (
      <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 p-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-teal-400 animate-pulse" />
          <span className="font-semibold text-teal-100">
            {session.subjectName || "专注学习"}
          </span>
          <span className="font-mono text-xs font-bold text-teal-300 tabular-nums">
            {formatClockDuration(elapsedSeconds)}
          </span>
        </div>
        <Link
          href={activitySourcePath(session)}
          onClick={onClose}
          className="flex h-7 items-center gap-1 rounded bg-teal-400 text-[#071011] px-2.5 font-semibold hover:bg-teal-300 shadow-[0_0_8px_rgba(45,212,191,0.2)]"
        >
          <Square size={11} className="fill-current" />
          <span>收口</span>
        </Link>
      </div>
    );
  }
  if (item.kind === "activity_paused" && session) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-amber-400" />
          <span className="font-semibold text-amber-100">
            {session.subjectName || "专注学习"} (暂停)
          </span>
          <span className="font-mono text-xs font-bold text-amber-200 tabular-nums">
            {formatClockDuration(elapsedSeconds)}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={isResuming}
          onClick={onDirectResume}
          className="flex h-7 items-center !gap-1 rounded !bg-teal-400 text-[#071011] !px-2.5 font-semibold hover:!bg-teal-300 shadow-[0_0_8px_rgba(45,212,191,0.2)]"
        >
          {isResuming ? (
            <RefreshCw size={11} className="animate-spin" />
          ) : (
            <Play size={11} className="fill-current" />
          )}
          <span>继续</span>
        </Button>
      </div>
    );
  }
  if (item.kind === "live_session_closing" && session) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400" />
          <span className="font-semibold text-emerald-100">
            {session.subjectName || "专注学习"}
          </span>
          <span className="text-[10px] text-emerald-300">待收口</span>
        </div>
        <Link
          href={activitySourcePath(session)}
          onClick={onClose}
          className="flex h-7 items-center gap-1 rounded bg-emerald-400 text-[#071011] px-2.5 font-semibold hover:bg-emerald-300"
        >
          <span>完成收口</span>
          <ArrowRight size={11} />
        </Link>
      </div>
    );
  }
  if (item.kind === "recovery_active") {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Zap size={14} className="text-amber-400 fill-amber-400/30" />
            <span className="font-semibold text-amber-200">
              精力恢复第 {item.stage || 1} 阶
            </span>
          </div>
          <span className="font-mono text-[11px] text-amber-300/80">
            目标 {item.targetMinutes} 分钟
          </span>
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              onClose();
              onOpenRecovery?.();
            }}
            className="flex h-7 items-center !gap-1 border border-amber-400/30 text-amber-200 hover:bg-amber-400/10 text-xs"
          >
            <Zap size={11} />
            <span>恢复指引</span>
          </Button>
          <Link
            href="/today"
            onClick={onClose}
            className="flex h-7 items-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-zinc-200 hover:text-white text-xs font-medium"
          >
            <span>今日行动</span>
            <ArrowRight size={11} />
          </Link>
        </div>
      </div>
    );
  }
  if (item.kind === "evening_review_due") {
    return (
      <div className="rounded-lg border border-indigo-400/30 bg-indigo-400/10 p-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Moon size={14} className="text-indigo-300 fill-indigo-400/20" />
          <span className="font-semibold text-indigo-200">晚间复盘待收口</span>
        </div>
        <Link
          href={item.reviewHref || "/roadmap/reviews/daily"}
          onClick={onClose}
          className="flex h-7 items-center gap-1 rounded bg-indigo-500/40 border border-indigo-400/40 text-indigo-100 px-2.5 font-semibold hover:bg-indigo-500/60 text-xs"
        >
          <span>前往复盘</span>
          <ArrowRight size={11} />
        </Link>
      </div>
    );
  }
  if (item.kind === "sync_issue") {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle size={14} className="text-amber-400" />
          <span className="font-semibold text-amber-200">离线数据待对账</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onRetrySync}
          className="flex h-7 items-center !gap-1 bg-amber-400/20 text-amber-200 hover:bg-amber-400/30 border-0 text-xs"
        >
          <RefreshCw size={11} />
          <span>立即对账</span>
        </Button>
      </div>
    );
  }
  if (item.kind === "confirmations_pending") {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileCheck2 size={14} className="text-amber-400" />
          <span className="font-semibold text-amber-200">
            {item.pendingConfirmationsCount || 1} 项待确认
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            onClose();
            onOpenAction?.("confirmation-center");
          }}
          className="flex h-7 items-center !gap-1 bg-amber-400/20 text-amber-200 hover:bg-amber-400/30 border-0 text-xs"
        >
          <span>去确认</span>
          <ArrowRight size={11} />
        </Button>
      </div>
    );
  }
  return null;
}
