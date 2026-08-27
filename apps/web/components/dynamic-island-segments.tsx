"use client";

import type React from "react";
import Link from "next/link";
import {
  Clock3,
  CornerDownLeft,
  Moon,
  Play,
  RefreshCw,
  Zap,
  ArrowRight,
  Search,
  Command,
  X,
} from "lucide-react";
import { formatClockDuration } from "@/lib/formatters";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { activitySourcePath } from "@/lib/navigation/activity-route";
import type {
  DynamicIslandActiveItem,
  DynamicIslandCapsuleKind,
  DynamicIslandCapsuleState,
} from "./dynamic-island-types";

// ============================================================================
// CapsuleBreathingDots: Multi-state carousel pagination indicator
// ============================================================================

export interface CapsuleBreathingDotsProps {
  count: number;
  activeIndex: number;
  className?: string;
}

export function CapsuleBreathingDots({ count, activeIndex, className }: CapsuleBreathingDotsProps) {
  if (count <= 1) return null;

  return (
    <div
      className={`inline-flex items-center gap-1 pl-1 select-none ${className ?? ""}`}
      title={`多状态轮播 (${activeIndex + 1}/${count})`}
      aria-label={`多状态轮播，当前第 ${activeIndex + 1} 项，共 ${count} 项`}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <span
          key={idx}
          className={`rounded-full transition-all duration-300 ${
            idx === activeIndex
              ? "size-1.5 bg-teal-400 shadow-[0_0_6px_rgba(45,212,191,0.8)] animate-pulse"
              : "size-1 bg-white/25 hover:bg-white/40"
          }`}
        />
      ))}
    </div>
  );
}

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
    activeCount = 1,
    tickerIndex = 0,
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
        {activeCount > 1 ? <CapsuleBreathingDots count={activeCount} activeIndex={tickerIndex} /> : null}
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
        {activeCount > 1 ? <CapsuleBreathingDots count={activeCount} activeIndex={tickerIndex} /> : null}
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
        {activeCount > 1 ? <CapsuleBreathingDots count={activeCount} activeIndex={tickerIndex} /> : null}
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
        {activeCount > 1 ? <CapsuleBreathingDots count={activeCount} activeIndex={tickerIndex} /> : null}
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
        {activeCount > 1 ? <CapsuleBreathingDots count={activeCount} activeIndex={tickerIndex} /> : null}
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
        {activeCount > 1 ? <CapsuleBreathingDots count={activeCount} activeIndex={tickerIndex} /> : null}
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
        {activeCount > 1 ? <CapsuleBreathingDots count={activeCount} activeIndex={tickerIndex} /> : null}
      </div>
    );
  }

  return null;
}

// ============================================================================
// CapsuleCenterSegment: Search Input, Icon & ⌘K Command Palette Trigger
// ============================================================================

export interface CapsuleCenterSegmentProps {
  query: string;
  onQueryChange: (query: string) => void;
  onOpenSearch: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onClearQuery?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  activeKind?: DynamicIslandCapsuleKind;
  capsuleState?: DynamicIslandCapsuleState;
  className?: string;
}

export function CapsuleCenterSegment(props: CapsuleCenterSegmentProps) {
  const {
    query,
    onQueryChange,
    onOpenSearch,
    onKeyDown,
    onClearQuery,
    inputRef,
    activeKind,
    capsuleState,
    className,
  } = props;

  const kind = activeKind ?? capsuleState?.kind ?? "idle";

  return (
    <div
      onClick={() => {
        onOpenSearch();
        inputRef?.current?.focus();
      }}
      className={`flex flex-1 min-w-0 items-center gap-1.5 px-1 cursor-text ${className ?? ""}`}
    >
      <Search size={13} className="shrink-0 text-zinc-500 transition-colors" />
      <Input
        ref={inputRef}
        type="text"
        value={query}
        onFocus={() => onOpenSearch()}
        onChange={(e) => {
          onQueryChange(e.target.value);
          onOpenSearch();
        }}
        onKeyDown={onKeyDown}
        placeholder={
          kind === "live_session_running"
            ? "搜索命令…"
            : kind !== "idle"
              ? "搜索或输入命令…"
              : "搜索或输入命令… ⌘K"
        }
        className="af-island-input !h-auto !min-h-0 !border-0 !bg-transparent !p-0 text-xs text-white placeholder:text-zinc-500 !ring-0 !shadow-none !outline-none focus:!border-0 focus:!ring-0 focus-visible:!outline-none selection:bg-teal-500/30 w-full min-w-0"
        style={{ outline: "none", boxShadow: "none", border: "none" }}
        aria-label="全局灵动岛搜索与命令输入框"
      />
      {query ? (
        <IconButton
          label="清除搜索输入"
          type="button"
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onClearQuery?.();
            inputRef?.current?.focus();
          }}
          className="!h-5 !w-5 !p-0.5 text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
        >
          <X size={13} />
        </IconButton>
      ) : kind === "idle" ? (
        <span className="inline-flex items-center gap-0.5 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 shrink-0 select-none">
          <Command size={11} />K
        </span>
      ) : null}
    </div>
  );
}

// ============================================================================
// CapsuleRightSegment: Direct 1-Click Action & Live Stopwatch
// ============================================================================

export interface CapsuleRightSegmentProps {
  activeItem?: DynamicIslandActiveItem;
  capsuleState?: DynamicIslandCapsuleState;
  isOpen?: boolean;
  isResuming?: boolean;
  elapsedSeconds?: number;
  onTriggerOpen?: () => void;
  onOpenFocus?: (e?: React.MouseEvent) => void;
  onDirectResume?: (e?: React.MouseEvent) => void;
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
    elapsedSeconds = 0,
    onTriggerOpen,
    onOpenFocus,
    onDirectResume,
    onRetrySync,
    onCloseDrawer,
    className,
  } = props;

  const kind: DynamicIslandCapsuleKind = activeItem?.kind ?? capsuleState?.kind ?? "idle";
  const session = activeItem?.session ?? capsuleState?.session;
  const elapsed = activeItem?.elapsedSeconds ?? elapsedSeconds;

  if (kind === "live_session_running" && session) {
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          (onOpenFocus ?? onTriggerOpen)?.(e);
        }}
        className={`flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10 hover:text-teal-100 transition-colors cursor-pointer select-none ${className ?? ""}`}
        title={isOpen ? "当前学习状态" : "点击展开控制"}
      >
        {isOpen ? (
          <span className="inline-flex items-center gap-1.5 text-teal-300 font-semibold">
            <span className="size-1.5 rounded-full bg-teal-400 animate-pulse" />
            <span>正在学习</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-mono font-bold text-teal-300 tabular-nums">
            <Clock3 size={13} className="text-teal-400 shrink-0" />
            <span>{formatClockDuration(elapsed)}</span>
          </span>
        )}
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
