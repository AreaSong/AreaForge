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
} from "lucide-react";
import { formatClockDuration } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { activitySourcePath } from "@/lib/navigation/activity-route";
import type { DynamicIslandCapsuleState } from "./dynamic-island";

export interface CapsuleLeftSegmentProps {
  capsuleState: DynamicIslandCapsuleState;
  onTriggerOpen: () => void;
}

export function CapsuleLeftSegment(props: CapsuleLeftSegmentProps) {
  const { capsuleState, onTriggerOpen } = props;
  const session = capsuleState.session;

  if (capsuleState.kind === "live_session_running" && session) {
    return (
      <div
        onClick={onTriggerOpen}
        className="flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-white hover:text-teal-200 transition-colors border-r border-white/10 cursor-pointer select-none"
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
        <span className="font-semibold text-teal-100 max-w-24 truncate">
          {session.subjectName}
        </span>
      </div>
    );
  }

  if (capsuleState.kind === "live_session_closing" && session) {
    return (
      <div
        onClick={onTriggerOpen}
        className="flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-white hover:text-emerald-200 transition-colors border-r border-white/10 cursor-pointer select-none"
        title="待收口沉淀"
      >
        <span className="size-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
        <span className="font-semibold text-emerald-100 max-w-24 truncate">
          {session.subjectName}
        </span>
      </div>
    );
  }

  if (capsuleState.kind === "activity_paused" && session) {
    return (
      <div
        onClick={onTriggerOpen}
        className="flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-white hover:text-emerald-200 transition-colors border-r border-white/10 cursor-pointer select-none"
        title="专注已暂停，点击展开"
      >
        <span className="size-2 shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
        <span className="font-semibold text-emerald-100 max-w-28 truncate">
          {session.subjectName} 暂停中
        </span>
      </div>
    );
  }

  if (capsuleState.kind === "recovery_active") {
    return (
      <div
        onClick={onTriggerOpen}
        className="flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-amber-200 hover:text-amber-100 transition-colors border-r border-white/10 cursor-pointer select-none"
        title="恢复模式激活中，点击查看详情"
      >
        <Zap
          size={13}
          className="text-amber-400 animate-pulse fill-amber-400/30 shrink-0"
        />
        <span className="font-semibold text-amber-200 truncate">
          ⚡ 恢复第{capsuleState.stage}阶
        </span>
      </div>
    );
  }

  if (capsuleState.kind === "evening_review_due") {
    return (
      <div
        onClick={onTriggerOpen}
        className="flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-indigo-200 hover:text-indigo-100 transition-colors border-r border-white/10 cursor-pointer select-none"
        title="晚间复盘待收口，点击展开"
      >
        <Moon
          size={13}
          className="text-indigo-300 fill-indigo-400/20 shrink-0"
        />
        <span className="font-semibold text-indigo-200 truncate">
          🌙 晚间复盘待收口
        </span>
      </div>
    );
  }

  if (capsuleState.kind === "sync_issue") {
    return (
      <div
        onClick={onTriggerOpen}
        className="flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-amber-200 border-r border-white/10 cursor-pointer select-none"
      >
        <span className="size-2 shrink-0 rounded-full bg-amber-400 animate-pulse" />
        <span className="max-w-24 truncate">离线待对账</span>
      </div>
    );
  }

  return null;
}

export interface CapsuleRightSegmentProps {
  capsuleState: DynamicIslandCapsuleState;
  isOpen: boolean;
  isResuming: boolean;
  elapsedSeconds: number;
  onTriggerOpen: () => void;
  onDirectResume: (e?: React.MouseEvent) => void;
  onRetrySync?: () => void;
  onCloseDrawer: () => void;
}

export function CapsuleRightSegment(props: CapsuleRightSegmentProps) {
  const {
    capsuleState,
    isOpen,
    isResuming,
    elapsedSeconds,
    onTriggerOpen,
    onDirectResume,
    onRetrySync,
    onCloseDrawer,
  } = props;
  const session = capsuleState.session;

  if (capsuleState.kind === "live_session_running" && session) {
    return (
      <div
        onClick={onTriggerOpen}
        className="flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10 hover:text-teal-100 transition-colors cursor-pointer select-none"
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
            <span>{formatClockDuration(elapsedSeconds)}</span>
          </span>
        )}
      </div>
    );
  }

  if (capsuleState.kind === "live_session_closing" && session) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10">
        <Link
          href={
            capsuleState.session
              ? activitySourcePath(capsuleState.session)
              : "/focus"
          }
          onClick={onCloseDrawer}
          className="flex items-center gap-1 font-semibold text-emerald-300 hover:text-emerald-100 transition-colors"
        >
          <span>去收口</span>
          <ArrowRight size={11} />
        </Link>
      </div>
    );
  }

  if (capsuleState.kind === "activity_paused" && session) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10">
        <span className="font-mono text-zinc-400 tabular-nums hidden sm:inline text-[11px]">
          {formatClockDuration(elapsedSeconds)}
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isResuming}
          onClick={onDirectResume}
          className="flex shrink-0 items-center !gap-1 !h-auto rounded bg-teal-400/20 !px-2 !py-0.5 text-[11px] font-semibold text-teal-200 hover:bg-teal-400/30 !border-0 cursor-pointer shadow-[0_0_8px_rgba(45,212,191,0.2)]"
          title="一键继续专注"
        >
          {isResuming ? (
            <RefreshCw size={10} className="animate-spin" />
          ) : (
            <Play size={10} className="fill-current" />
          )}
          <span>继续</span>
        </Button>
      </div>
    );
  }

  if (capsuleState.kind === "recovery_active") {
    return (
      <div
        onClick={onTriggerOpen}
        className="flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10 hover:text-amber-100 transition-colors cursor-pointer select-none"
      >
        <span className="text-[11px] font-medium text-amber-300/90">
          需完成最小行动
        </span>
      </div>
    );
  }

  if (capsuleState.kind === "evening_review_due") {
    return (
      <div className="flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10">
        <Link
          href={capsuleState.reviewHref || "/roadmap/reviews/daily"}
          onClick={onCloseDrawer}
          className="flex items-center gap-1 text-[11px] font-medium text-indigo-300 hover:text-white transition-colors"
        >
          <span>去收口</span>
          <CornerDownLeft size={11} />
        </Link>
      </div>
    );
  }

  if (
    capsuleState.kind === "sync_issue" &&
    capsuleState.syncState === "deferred" &&
    onRetrySync
  ) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={(e) => {
          e.stopPropagation();
          onRetrySync();
        }}
        className="flex shrink-0 items-center !gap-1 !h-auto rounded bg-amber-400/20 !px-2 !py-0.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-400/30 !border-0 border-l border-white/10 cursor-pointer"
        leftIcon={<RefreshCw size={11} className="animate-spin" />}
      >
        <span>对账</span>
      </Button>
    );
  }

  return null;
}
