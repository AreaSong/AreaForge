"use client";

import type React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Maximize2,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { formatClockDuration } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { activitySourcePath } from "@/lib/navigation/activity-route";
import type {
  DynamicIslandActiveItem,
  DynamicIslandAuraTheme,
} from "./dynamic-island-types";

export function HubFlowStopwatchPanel(props: {
  activeItem?: DynamicIslandActiveItem;
  dominantState: DynamicIslandActiveItem;
  elapsedSeconds: number;
  isResuming: boolean;
  onDirectResume: (e?: React.MouseEvent) => void;
  onClose: () => void;
  auraTheme?: DynamicIslandAuraTheme;
}) {
  const {
    activeItem,
    dominantState,
    elapsedSeconds,
    isResuming,
    onDirectResume,
    onClose,
  } = props;
  const item = activeItem || dominantState;
  const session = item.session;

  if (
    session &&
    (item.kind === "live_session_running" ||
      item.kind === "activity_paused" ||
      item.kind === "live_session_closing")
  ) {
    const isRunning = item.kind === "live_session_running";
    const isPaused = item.kind === "activity_paused";

    return (
      <div className="flex flex-col gap-3 py-1">
        <div className="flex flex-col items-center justify-center py-2 text-center">
          <div
            className={`font-mono text-3xl font-bold tracking-tight tabular-nums ${
              isRunning
                ? "text-teal-300 drop-shadow-[0_0_16px_rgba(45,212,191,0.35)]"
                : isPaused
                ? "text-amber-200 drop-shadow-[0_0_16px_rgba(251,191,36,0.25)]"
                : "text-emerald-200"
            }`}
          >
            {formatClockDuration(elapsedSeconds)}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
            <span className="font-semibold text-white">
              {session.subjectName || "专注学习"}
            </span>
            <span>·</span>
            <span
              className={
                isRunning
                  ? "text-teal-400"
                  : isPaused
                  ? "text-amber-400"
                  : "text-emerald-400"
              }
            >
              {isRunning
                ? "🟢 深度专注中"
                : isPaused
                ? "🟡 专注已暂停"
                : "🏁 待收口沉淀"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {isPaused ? (
            <Button
              type="button"
              disabled={isResuming}
              onClick={onDirectResume}
              className="flex h-8 items-center justify-center !gap-1.5 rounded-lg !bg-teal-400 text-[#071011] !px-3 text-xs font-semibold shadow-[0_0_12px_rgba(45,212,191,0.25)] hover:!bg-teal-300"
            >
              {isResuming ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Play size={13} className="fill-current" />
              )}
              <span>立即继续学习</span>
            </Button>
          ) : (
            <Link
              href={activitySourcePath(session)}
              onClick={onClose}
              className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/10 hover:text-white transition-all"
            >
              <Maximize2 size={13} />
              <span>全屏专注视图</span>
            </Link>
          )}
          <Link
            href={activitySourcePath(session)}
            onClick={onClose}
            className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-teal-400/50 bg-teal-400 text-[#071011] px-3 text-xs font-semibold shadow-[0_0_12px_rgba(45,212,191,0.25)] hover:bg-teal-300 transition-all"
          >
            <Square size={13} className="fill-current" />
            <span>前往结束收口</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-4 text-center">
      <div className="font-mono text-3xl font-bold tracking-tight text-zinc-600 tabular-nums">
        00:00:00
      </div>
      <div className="mt-1 text-xs text-zinc-400 font-medium">
        ⚪ 当前未在专注学习中
      </div>
      <p className="mt-1 text-[11px] text-zinc-500 max-w-xs">
        选择任意科目即可开启沉浸式正向心流秒表，系统将全程守护备考节奏。
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 w-full max-w-xs">
        <Link
          href="/focus"
          onClick={onClose}
          className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-teal-400/50 bg-teal-400 text-[#071011] px-3 text-xs font-semibold shadow-[0_0_12px_rgba(45,212,191,0.2)] hover:bg-teal-300 transition-all"
        >
          <Play size={12} className="fill-current" />
          <span>开始新专注</span>
        </Link>
        <Link
          href="/today"
          onClick={onClose}
          className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/10 hover:text-white transition-all"
        >
          <span>今日任务</span>
          <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}
