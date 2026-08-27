"use client";

import Link from "next/link";
import {
  Clock3,
  CornerDownLeft,
  Maximize2,
  Moon,
  Play,
  RefreshCw,
  Square,
  Zap,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { formatClockDuration } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { activitySourcePath } from "@/lib/navigation/activity-route";
import type { GlobalCommandDefinition } from "@/lib/navigation/command-palette";
import type { DynamicIslandCapsuleKind, DynamicIslandCapsuleState } from "./dynamic-island";

export function getCapsuleGlowStyle(kind: DynamicIslandCapsuleKind, isOpen: boolean): string {
  if (isOpen) return "";
  switch (kind) {
    case "live_session_running":
      return "border-teal-500/40 shadow-[0_0_20px_rgba(45,212,191,0.22)] ring-1 ring-teal-400/20 hover:border-teal-400/60";
    case "live_session_closing":
      return "border-emerald-500/40 shadow-[0_0_16px_rgba(52,211,153,0.2)] ring-1 ring-emerald-400/20 hover:border-emerald-400/60";
    case "activity_paused":
      return "border-emerald-500/35 shadow-[0_0_16px_rgba(52,211,153,0.15)] ring-1 ring-emerald-500/20 hover:border-emerald-400/50";
    case "recovery_active":
      return "border-amber-400/40 shadow-[0_0_18px_rgba(251,191,36,0.18)] ring-1 ring-amber-400/20 hover:border-amber-400/60";
    case "evening_review_due":
      return "border-indigo-400/40 shadow-[0_0_18px_rgba(129,140,248,0.2)] ring-1 ring-indigo-400/20 hover:border-indigo-300/60";
    case "sync_issue":
      return "border-amber-400/35 shadow-[0_0_16px_rgba(251,191,36,0.12)] hover:border-amber-400/50";
    case "idle":
    default:
      return "border-white/10 hover:border-teal-400/30 hover:bg-white/[0.04]";
  }
}

export function DynamicIslandHeroDrawer(props: {
  capsuleState: DynamicIslandCapsuleState;
  elapsedSeconds: number;
  isResuming: boolean;
  onDirectResume: () => void;
  onOpenRecovery: () => void;
  onCloseDrawer: () => void;
}) {
  const { capsuleState, elapsedSeconds, isResuming, onDirectResume, onOpenRecovery, onCloseDrawer } = props;
  const session = capsuleState.session;

  if (capsuleState.kind === "live_session_running" && session) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col items-center justify-center py-2 text-center">
          <div className="font-mono text-3xl font-bold tracking-tight text-white tabular-nums drop-shadow-[0_0_16px_rgba(45,212,191,0.3)]">
            {formatClockDuration(elapsedSeconds)}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="font-medium text-teal-400">🟢 深度专注中</span>
            <span>·</span>
            <span>⏱️ 正向心流计时</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Link href={activitySourcePath(session)} onClick={onCloseDrawer} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/10 hover:text-white transition-all">
            <Maximize2 size={13} />
            <span>全屏专注视图</span>
          </Link>
          <Link href={activitySourcePath(session)} onClick={onCloseDrawer} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-teal-400/50 bg-teal-400 text-[#071011] px-3 text-xs font-semibold shadow-[0_0_12px_rgba(45,212,191,0.25)] hover:bg-teal-300 transition-all">
            <Square size={13} className="fill-current" />
            <span>前往结束收口</span>
          </Link>
        </div>
      </div>
    );
  }

  if (capsuleState.kind === "activity_paused" && session) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col items-center justify-center py-2 text-center">
          <div className="font-mono text-3xl font-bold tracking-tight text-amber-200 tabular-nums drop-shadow-[0_0_16px_rgba(251,191,36,0.25)]">
            {formatClockDuration(elapsedSeconds)}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="font-medium text-amber-400">🟡 专注已暂停</span>
            <span>·</span>
            <span>已保存断点，随时可继续</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="primary"
            disabled={isResuming}
            onClick={onDirectResume}
            className="flex h-8 items-center justify-center !gap-1.5 rounded-lg !bg-teal-400 text-[#071011] !px-3 text-xs font-semibold shadow-[0_0_12px_rgba(45,212,191,0.25)] hover:!bg-teal-300"
          >
            {isResuming ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} className="fill-current" />}
            <span>立即继续学习</span>
          </Button>
          <Link href={activitySourcePath(session)} onClick={onCloseDrawer} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/10 hover:text-white transition-all">
            <Maximize2 size={13} />
            <span>全屏专注视图</span>
          </Link>
        </div>
      </div>
    );
  }

  if (capsuleState.kind === "live_session_closing" && session) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col items-center justify-center py-2 text-center">
          <div className="font-mono text-3xl font-bold tracking-tight text-emerald-200 tabular-nums">{formatClockDuration(elapsedSeconds)}</div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="font-medium text-emerald-400">🏁 待收口沉淀</span>
            <span>·</span>
            <span>请关联本次专注产出与学习证据</span>
          </div>
        </div>
        <Link href={activitySourcePath(session)} onClick={onCloseDrawer} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-emerald-400/50 bg-emerald-400 text-[#071011] px-3 text-xs font-semibold shadow-[0_0_12px_rgba(52,211,153,0.25)] hover:bg-emerald-300 transition-all">
          <Square size={13} className="fill-current" />
          <span>前往完成收口</span>
        </Link>
      </div>
    );
  }

  if (capsuleState.kind === "recovery_active") {
    const stage = capsuleState.stage || 1;
    return (
      <div className="flex flex-col gap-3 py-1">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            <Zap size={15} className="text-amber-400 fill-amber-400/30" />
            <span className="text-xs font-semibold text-amber-200">精力恢复模式 · 第 {stage} 阶</span>
          </div>
          <span className="text-[11px] text-amber-300/80 font-mono">今日目标 {capsuleState.targetMinutes} 分钟</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`rounded-md p-1.5 text-[10px] transition-colors ${
                s === stage
                  ? "border border-amber-400/40 bg-amber-400/15 text-amber-200 font-semibold ring-1 ring-amber-400/30"
                  : s < stage
                  ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border border-white/5 bg-white/[0.02] text-zinc-500"
              }`}
            >
              <div>第 {s} 阶</div>
              <div className="font-mono mt-0.5">{s === 1 ? "30m" : s === 2 ? "60m" : "90m"}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-zinc-400">当前处于精力恢复模式，今日只需完成阶段最小专注，无需背负全部备考压力。</p>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={() => { onCloseDrawer(); onOpenRecovery(); }} className="flex h-8 items-center justify-center !gap-1.5 rounded-lg border border-amber-400/30 text-amber-200 hover:bg-amber-400/10">
            <Zap size={12} />
            <span>打开恢复指引</span>
          </Button>
          <Link href="/today" onClick={onCloseDrawer} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/10 hover:text-white transition-all">
            <span>前往今日行动</span>
            <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    );
  }

  if (capsuleState.kind === "evening_review_due") {
    return (
      <div className="flex flex-col gap-3 py-1">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            <Moon size={15} className="text-indigo-300 fill-indigo-400/20" />
            <span className="text-xs font-semibold text-indigo-200">🌙 晚间复盘待收口</span>
          </div>
          <span className="text-[11px] text-zinc-400">20:00 每日闭环</span>
        </div>
        <div className="space-y-1.5 rounded-lg border border-white/5 bg-white/[0.02] p-2 text-xs">
          <div className="flex items-center justify-between text-zinc-300">
            <span>最低有效行动</span>
            {capsuleState.minimumActionDone ? (
              <span className="flex items-center gap-1 text-teal-300"><CheckCircle2 size={12} />已达成</span>
            ) : (
              <span className="flex items-center gap-1 text-amber-300"><AlertCircle size={12} />待完成</span>
            )}
          </div>
          <div className="flex items-center justify-between text-zinc-300">
            <span>今日每日复盘</span>
            {capsuleState.dailyReviewDone ? (
              <span className="flex items-center gap-1 text-teal-300"><CheckCircle2 size={12} />已提交</span>
            ) : (
              <span className="flex items-center gap-1 text-indigo-300"><Clock3 size={12} />待沉淀</span>
            )}
          </div>
        </div>
        <Link href={capsuleState.reviewHref || "/roadmap/reviews/daily"} onClick={onCloseDrawer} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-indigo-400/50 bg-indigo-500/30 text-indigo-100 px-3 text-xs font-semibold shadow-[0_0_12px_rgba(129,140,248,0.2)] hover:bg-indigo-500/40 transition-all">
          <span>前往每日复盘</span>
          <ArrowRight size={13} />
        </Link>
      </div>
    );
  }

  return null;
}

export function DynamicIslandCommandList(props: {
  commands: readonly GlobalCommandDefinition[];
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
  onExecuteCommand: (cmd: GlobalCommandDefinition) => void;
}) {
  const { commands, selectedIndex, onSelectIndex, onExecuteCommand } = props;

  return (
    <div className="max-h-60 overflow-y-auto space-y-0.5 focus-scrollbar pt-1">
      {commands.length > 0 ? (
        commands.map((cmd, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <div
              key={cmd.id}
              onClick={() => onExecuteCommand(cmd)}
              onMouseEnter={() => onSelectIndex(idx)}
              className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                isSelected ? "bg-teal-500/15 text-teal-200 ring-1 ring-teal-400/30" : "text-zinc-300 hover:bg-white/5"
              }`}
              role="option"
              aria-selected={isSelected}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-medium text-white truncate">{cmd.label}</span>
                <span className="hidden sm:inline text-[11px] text-zinc-500 truncate">{cmd.description}</span>
              </div>
              {isSelected ? (
                <span className="flex items-center gap-1 text-[10px] font-mono text-teal-400 shrink-0">
                  <span>跳转</span>
                  <CornerDownLeft size={11} />
                </span>
              ) : null}
            </div>
          );
        })
      ) : (
        <div className="py-5 text-center text-xs text-zinc-500">未找到匹配的结果或命令</div>
      )}
    </div>
  );
}
