"use client";

import type React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Clock3,
  CornerDownLeft,
  Moon,
  Pause,
  Play,
  RefreshCw,
  Square,
  Zap,
} from "lucide-react";
import { formatClockDuration } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { activitySourcePath } from "@/lib/navigation/activity-route";
import type {
  DynamicIslandActiveItem,
  DynamicIslandCapsuleKind,
  DynamicIslandCapsuleState,
} from "./dynamic-island-types";
import {
  SatelliteBubble,
  type SatelliteBubbleProps,
} from "./dynamic-island-satellite";
import {
  CapsuleBreathingDots,
  type CapsuleBreathingDotsProps,
  CapsuleCenterSegment,
  type CapsuleCenterSegmentProps,
} from "./dynamic-island-capsule-body";

export {
  SatelliteBubble,
  type SatelliteBubbleProps,
  CapsuleBreathingDots,
  type CapsuleBreathingDotsProps,
  CapsuleCenterSegment,
  type CapsuleCenterSegmentProps,
};

// ============================================================================
// CapsuleLeftSegment: Status Tone, Title & Ticker Carousel
// ============================================================================

export interface CapsuleLeftSegmentProps {
  activeItem?: DynamicIslandActiveItem;
  capsuleState?: DynamicIslandCapsuleState;
  activeCount?: number;
  tickerIndex?: number;
  onOpenOverview?: (e?: React.MouseEvent) => void;
  onTriggerOpen?: () => void;
  className?: string;
}

export function CapsuleLeftSegment(props: CapsuleLeftSegmentProps) {
  const {
    activeItem,
    capsuleState,
    onOpenOverview,
    onTriggerOpen,
    className,
  } = props;

  const kind: DynamicIslandCapsuleKind = activeItem?.kind ?? capsuleState?.kind ?? "idle";
  const session = activeItem?.session ?? capsuleState?.session;
  const stage = activeItem?.stage ?? capsuleState?.stage ?? 1;
  const title = activeItem?.title;
  const pendingConfirmationsCount =
    activeItem?.pendingConfirmationsCount ?? capsuleState?.pendingConfirmationsCount ?? 0;

  const handleLeftClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    (onOpenOverview ?? onTriggerOpen)?.(e);
  };

  if (kind === "live_session_running" && session) {
    return (
      <div
        onClick={handleLeftClick}
        className={`flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-white hover:text-teal-200 transition-colors border-r border-white/10 cursor-pointer select-none ${className ?? ""}`}
        title="点击展开专注控制"
      >
        <span
          className={`size-2 shrink-0 rounded-full ${
            session.status === "running"
              ? "bg-teal-400 animate-pulse"
              : session.status === "closing"
                ? "bg-emerald-400"
                : "bg-amber-400"
          }`}
        />
        <span className="font-semibold text-teal-100 max-w-24 truncate">{session.subjectName || "专注学习"}</span>
      </div>
    );
  }

  if (kind === "live_session_closing" && session) {
    return (
      <div
        onClick={handleLeftClick}
        className={`flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-white hover:text-emerald-200 transition-colors border-r border-white/10 cursor-pointer select-none ${className ?? ""}`}
        title="待收口沉淀"
      >
        <span className="size-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
        <span className="font-semibold text-emerald-100 max-w-24 truncate">{session.subjectName || "专注学习"}</span>
      </div>
    );
  }

  if (kind === "activity_paused" && session) {
    return (
      <div
        onClick={handleLeftClick}
        className={`flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-white hover:text-emerald-200 transition-colors border-r border-white/10 cursor-pointer select-none ${className ?? ""}`}
        title="专注已暂停，点击展开"
      >
        <span className="size-2 shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
        <span className="font-semibold text-emerald-100 max-w-28 truncate">{session.subjectName || "专注学习"} 暂停中</span>
      </div>
    );
  }

  if (kind === "recovery_active") {
    return (
      <div
        onClick={handleLeftClick}
        className={`flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-amber-200 hover:text-amber-100 transition-colors border-r border-white/10 cursor-pointer select-none ${className ?? ""}`}
        title="恢复模式激活中，点击查看详情"
      >
        <Zap size={13} className="text-amber-400 animate-pulse fill-amber-400/30 shrink-0" />
        <span className="font-semibold text-amber-200 truncate">⚡ 恢复第{stage}阶</span>
      </div>
    );
  }

  if (kind === "evening_review_due") {
    return (
      <div
        onClick={handleLeftClick}
        className={`flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-indigo-200 hover:text-indigo-100 transition-colors border-r border-white/10 cursor-pointer select-none ${className ?? ""}`}
        title="晚间复盘待收口，点击展开"
      >
        <Moon size={13} className="text-indigo-300 fill-indigo-400/20 shrink-0" />
        <span className="font-semibold text-indigo-200 truncate">🌙 晚间复盘待收口</span>
      </div>
    );
  }

  if (kind === "sync_issue") {
    return (
      <div
        onClick={handleLeftClick}
        className={`flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-amber-200 border-r border-white/10 cursor-pointer select-none ${className ?? ""}`}
        title="离线待对账，点击查看详情"
      >
        <span className="size-2 shrink-0 rounded-full bg-amber-400 animate-pulse" />
        <span className="max-w-24 truncate font-semibold">{title || "离线待对账"}</span>
      </div>
    );
  }

  if (kind === "confirmations_pending") {
    return (
      <div
        onClick={handleLeftClick}
        className={`flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-amber-200 border-r border-white/10 cursor-pointer select-none ${className ?? ""}`}
        title="待确认事项，点击查看"
      >
        <span className="size-2 shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
        <span className="max-w-24 truncate font-semibold">{pendingConfirmationsCount}项待确认</span>
      </div>
    );
  }

  return null;
}

// ============================================================================
// CapsuleRightSegment: Direct 1-Click Action & Live Stopwatch
// ============================================================================

export interface CapsuleRightSegmentProps {
  activeItem?: DynamicIslandActiveItem;
  capsuleState?: DynamicIslandCapsuleState;
  isOpen?: boolean;
  isResuming?: boolean;
  isPausing?: boolean;
  elapsedSeconds?: number;
  onTriggerOpen?: () => void;
  onOpenFocus?: (e?: React.MouseEvent) => void;
  onDirectResume?: (e?: React.MouseEvent) => void;
  onDirectPause?: (e?: React.MouseEvent) => void;
  onDirectCloseout?: (e?: React.MouseEvent) => void;
  onRetrySync?: () => void;
  onCloseDrawer?: () => void;
  className?: string;
}

export function CapsuleRightSegment(props: CapsuleRightSegmentProps) {
  const {
    activeItem,
    capsuleState,
    isOpen = false,
    isResuming = false,
    isPausing = false,
    elapsedSeconds = 0,
    onTriggerOpen,
    onOpenFocus,
    onDirectResume,
    onDirectPause,
    onDirectCloseout,
    onRetrySync,
    onCloseDrawer,
    className,
  } = props;

  const kind: DynamicIslandCapsuleKind = activeItem?.kind ?? capsuleState?.kind ?? "idle";
  const session = activeItem?.session ?? capsuleState?.session;
  const elapsed = activeItem?.elapsedSeconds ?? elapsedSeconds;

  if (kind === "live_session_running" && session) {
    if (isOpen) {
      return (
        <div
          onClick={(e) => {
            e.stopPropagation();
            (onOpenFocus ?? onTriggerOpen)?.(e);
          }}
          className={`flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10 hover:text-teal-100 transition-colors cursor-pointer select-none ${className ?? ""}`}
          title="当前学习状态"
        >
          <span className="inline-flex items-center gap-1.5 text-teal-300 font-semibold">
            <span className="size-1.5 rounded-full bg-teal-400 animate-pulse" />
            <span>正在学习</span>
          </span>
        </div>
      );
    }

    return (
      <div
        className={`group/right relative flex shrink-0 items-center pl-2.5 text-xs font-medium border-l border-white/10 select-none ${className ?? ""}`}
      >
        {/* Default Stopwatch Display */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            (onOpenFocus ?? onTriggerOpen)?.(e);
          }}
          className="flex items-center gap-1.5 font-mono font-bold text-teal-300 tabular-nums cursor-pointer transition-opacity duration-150 group-hover/right:opacity-0"
          title="点击展开专注控制"
        >
          <Clock3 size={13} className="text-teal-400 shrink-0" />
          <span>{formatClockDuration(elapsed)}</span>
        </div>

        {/* Hover Micro-Actions: [ ⏸ 暂停 ] [ 🏁 收口 ] */}
        <div className="absolute inset-y-0 right-0 hidden items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/right:flex group-hover/right:opacity-100 z-10">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isPausing}
            onClick={(e) => {
              e.stopPropagation();
              onDirectPause?.(e);
            }}
            className="flex !h-6 items-center !gap-1 rounded bg-amber-400/20 !px-1.5 !py-0.5 text-[10px] font-semibold text-amber-200 hover:bg-amber-400/30 !border-0 cursor-pointer shadow-[0_0_8px_rgba(251,191,36,0.2)]"
            title="快速暂停专注"
          >
            {isPausing ? (
              <RefreshCw size={10} className="animate-spin" />
            ) : (
              <Pause size={10} className="fill-current" />
            )}
            <span>暂停</span>
          </Button>
          <Link
            href={session ? activitySourcePath(session) : "/focus"}
            onClick={(e) => {
              e.stopPropagation();
              onDirectCloseout?.(e);
              onCloseDrawer?.();
            }}
            className="flex h-6 items-center gap-1 rounded bg-teal-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-teal-200 hover:bg-teal-400/30 border-0 cursor-pointer shadow-[0_0_8px_rgba(45,212,191,0.2)]"
            title="前往结束收口"
          >
            <Square size={10} className="fill-current" />
            <span>收口</span>
          </Link>
        </div>
      </div>
    );
  }

  if (kind === "live_session_closing" && session) {
    return (
      <div className={`flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10 ${className ?? ""}`}>
        <Link
          href={session ? activitySourcePath(session) : "/focus"}
          onClick={(e) => {
            e.stopPropagation();
            onCloseDrawer?.();
          }}
          className="flex items-center gap-1 font-semibold text-emerald-300 hover:text-emerald-100 transition-colors"
          title="前往完成收口"
        >
          <span>去收口</span>
          <ArrowRight size={11} />
        </Link>
      </div>
    );
  }

  if (kind === "activity_paused" && session) {
    return (
      <div className={`flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10 ${className ?? ""}`}>
        <span className="font-mono text-zinc-400 tabular-nums hidden sm:inline text-[11px]">
          {formatClockDuration(elapsed)}
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isResuming}
          onClick={(e) => {
            e.stopPropagation();
            onDirectResume?.(e);
          }}
          className="flex shrink-0 items-center !gap-1 !h-auto rounded bg-teal-400/20 !px-2 !py-0.5 text-[11px] font-semibold text-teal-200 hover:bg-teal-400/30 !border-0 cursor-pointer shadow-[0_0_8px_rgba(45,212,191,0.2)]"
          title="一键继续专注"
        >
          {isResuming ? <RefreshCw size={10} className="animate-spin" /> : <Play size={10} className="fill-current" />}
          <span>继续</span>
        </Button>
        <Link
          href={session ? activitySourcePath(session) : "/focus"}
          onClick={(e) => {
            e.stopPropagation();
            onDirectCloseout?.(e);
            onCloseDrawer?.();
          }}
          className="hidden sm:flex h-6 items-center gap-0.5 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-white/10 hover:text-white border-0 transition-colors"
          title="前往结束收口"
        >
          <Square size={9} className="fill-current" />
          <span>收口</span>
        </Link>
      </div>
    );
  }

  if (kind === "recovery_active") {
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          onTriggerOpen?.();
        }}
        className={`flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10 hover:text-amber-100 transition-colors cursor-pointer select-none ${className ?? ""}`}
        title="点击查看精力恢复指引"
      >
        <span className="text-[11px] font-medium text-amber-300/90">需完成最小行动</span>
      </div>
    );
  }

  if (kind === "evening_review_due") {
    return (
      <div className={`flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10 ${className ?? ""}`}>
        <Link
          href={activeItem?.reviewHref || capsuleState?.reviewHref || "/roadmap/reviews/daily"}
          onClick={(e) => {
            e.stopPropagation();
            onCloseDrawer?.();
          }}
          className="flex items-center gap-1 text-[11px] font-medium text-indigo-300 hover:text-white transition-colors"
          title="前往每日复盘收口"
        >
          <span>去收口</span>
          <CornerDownLeft size={11} />
        </Link>
      </div>
    );
  }

  if (kind === "sync_issue") {
    return (
      <div className={`flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10 ${className ?? ""}`}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onRetrySync?.();
          }}
          className="flex shrink-0 items-center !gap-1 !h-auto rounded bg-amber-400/20 !px-2 !py-0.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-400/30 !border-0 cursor-pointer"
          leftIcon={<RefreshCw size={11} />}
          title="立即对账重试"
        >
          <span>对账</span>
        </Button>
      </div>
    );
  }

  if (kind === "confirmations_pending") {
    return (
      <div className={`flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10 ${className ?? ""}`}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onTriggerOpen?.();
          }}
          className="flex shrink-0 items-center !gap-1 !h-auto rounded bg-amber-400/20 !px-2 !py-0.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-400/30 !border-0 cursor-pointer"
          title="查看待确认决策"
        >
          <span>去确认</span>
          <ArrowRight size={10} />
        </Button>
      </div>
    );
  }

  return null;
}
