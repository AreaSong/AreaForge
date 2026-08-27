"use client";

import type React from "react";
import Link from "next/link";
import {
  Clock3, CornerDownLeft, Maximize2, Moon, Play, RefreshCw, Square, Zap,
  CheckCircle2, AlertCircle, ArrowRight, Search, Layers, FileCheck2, Sparkles,
} from "lucide-react";
import { formatClockDuration } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { activitySourcePath } from "@/lib/navigation/activity-route";
import type { GlobalCommandAction, GlobalCommandDefinition } from "@/lib/navigation/command-palette";
import type { DynamicIslandActiveItem, DynamicIslandEveningReviewProps } from "./dynamic-island-types";

export type HubViewMode = "search" | "overview" | "focus" | "closure";
export interface DynamicIslandHubProps {
  isOpen: boolean;
  viewMode: HubViewMode;
  onViewModeChange: (mode: HubViewMode) => void;
  onClose: () => void;
  activeStates: readonly DynamicIslandActiveItem[];
  dominantState: DynamicIslandActiveItem;
  elapsedSeconds: number;
  isResuming?: boolean;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  commands: readonly GlobalCommandDefinition[];
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
  onExecuteCommand: (cmd: GlobalCommandDefinition) => void;
  onDirectResume: (e?: React.MouseEvent) => Promise<void> | void;
  onRetrySync?: () => void;
  onOpenRecovery?: () => void;
  onOpenAction?: (cmd: GlobalCommandAction) => void;
  eveningReview?: DynamicIslandEveningReviewProps | null;
  pendingConfirmationsCount?: number;
}
export function HubViewModeTabs(props: {
  viewMode: HubViewMode;
  onViewModeChange: (mode: HubViewMode) => void;
  activeStatesCount: number;
  hasRunningSession: boolean;
  pendingConfirmationsCount: number;
  eveningDue: boolean;
}) {
  const { viewMode, onViewModeChange, activeStatesCount, hasRunningSession, pendingConfirmationsCount, eveningDue } = props;
  const tabs: Array<{ id: HubViewMode; label: string; icon: React.ReactNode; badge?: React.ReactNode }> = [
    { id: "search", label: "命令搜索", icon: <Search size={12} /> },
    {
      id: "overview", label: "督战全景", icon: <Layers size={12} />,
      badge: activeStatesCount > 0 ? <span className="ml-1 rounded-full bg-teal-400/20 px-1 text-[9px] font-mono text-teal-300">{activeStatesCount}</span> : null,
    },
    {
      id: "focus", label: "专注心流", icon: <Clock3 size={12} />,
      badge: hasRunningSession ? <span className="ml-1 size-1.5 rounded-full bg-teal-400 animate-pulse" /> : null,
    },
    {
      id: "closure", label: "晚间指引", icon: <Moon size={12} />,
      badge: pendingConfirmationsCount > 0 || eveningDue ? (
        <span className="ml-1 rounded-full bg-amber-400/20 px-1 text-[9px] font-mono text-amber-300">{pendingConfirmationsCount > 0 ? pendingConfirmationsCount : "!"}</span>
      ) : null,
    },
  ];

  return (
    <div className="flex items-center gap-1 border-b border-white/10 pb-2 mb-2 select-none overflow-x-auto focus-scrollbar">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={(e) => { e.stopPropagation(); onViewModeChange(t.id); }}
          className={`flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
            viewMode === t.id
              ? "bg-teal-500/20 text-teal-200 border border-teal-400/40 ring-1 ring-teal-400/30 shadow-[0_0_12px_rgba(45,212,191,0.15)]"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200 border border-transparent"
          }`}
        >
          {t.icon}<span>{t.label}</span>{t.badge}
        </button>
      ))}
    </div>
  );
}
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
}) {
  const { activeStates, elapsedSeconds, isResuming, onDirectResume, onOpenRecovery, onRetrySync, onOpenAction, onClose } = props;
  const realStates = activeStates.filter((s) => s.kind !== "idle");

  if (realStates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center text-xs">
        <Sparkles size={22} className="text-teal-400/60 mb-2 animate-pulse" />
        <div className="font-semibold text-zinc-200">督战系统一切就绪</div>
        <div className="mt-1 text-zinc-500 max-w-xs leading-relaxed">当前无活跃警报或阻塞事项，各项闭环均已归档。</div>
        <Link href="/today" onClick={onClose} className="mt-3 inline-flex h-7 items-center gap-1 rounded-md bg-white/5 px-3 font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-colors">
          <span>查看今日行动</span><ArrowRight size={11} />
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
          elapsedSeconds={elapsedSeconds}
          isResuming={isResuming}
          onDirectResume={onDirectResume}
          onOpenRecovery={onOpenRecovery}
          onRetrySync={onRetrySync}
          onOpenAction={onOpenAction}
          onClose={onClose}
        />
      ))}
    </div>
  );
}
function OverviewStateCard(props: {
  item: DynamicIslandActiveItem;
  elapsedSeconds: number;
  isResuming: boolean;
  onDirectResume: (e?: React.MouseEvent) => void;
  onOpenRecovery?: () => void;
  onRetrySync?: () => void;
  onOpenAction?: (action: GlobalCommandAction) => void;
  onClose: () => void;
}) {
  const { item, elapsedSeconds, isResuming, onDirectResume, onOpenRecovery, onRetrySync, onOpenAction, onClose } = props;
  const session = item.session;

  if (item.kind === "live_session_running" && session) {
    return (
      <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 p-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-teal-400 animate-pulse" />
          <span className="font-semibold text-teal-100">{session.subjectName || "专注学习"}</span>
          <span className="font-mono text-xs font-bold text-teal-300 tabular-nums">{formatClockDuration(elapsedSeconds)}</span>
        </div>
        <Link href={activitySourcePath(session)} onClick={onClose} className="flex h-7 items-center gap-1 rounded bg-teal-400 text-[#071011] px-2.5 font-semibold hover:bg-teal-300 shadow-[0_0_8px_rgba(45,212,191,0.2)]">
          <Square size={11} className="fill-current" /><span>收口</span>
        </Link>
      </div>
    );
  }
  if (item.kind === "activity_paused" && session) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-amber-400" />
          <span className="font-semibold text-amber-100">{session.subjectName || "专注学习"} (暂停)</span>
          <span className="font-mono text-xs font-bold text-amber-200 tabular-nums">{formatClockDuration(elapsedSeconds)}</span>
        </div>
        <Button type="button" size="sm" disabled={isResuming} onClick={onDirectResume} className="flex h-7 items-center !gap-1 rounded !bg-teal-400 text-[#071011] !px-2.5 font-semibold hover:!bg-teal-300 shadow-[0_0_8px_rgba(45,212,191,0.2)]">
          {isResuming ? <RefreshCw size={11} className="animate-spin" /> : <Play size={11} className="fill-current" />}<span>继续</span>
        </Button>
      </div>
    );
  }
  if (item.kind === "live_session_closing" && session) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400" />
          <span className="font-semibold text-emerald-100">{session.subjectName || "专注学习"}</span>
          <span className="text-[10px] text-emerald-300">待收口</span>
        </div>
        <Link href={activitySourcePath(session)} onClick={onClose} className="flex h-7 items-center gap-1 rounded bg-emerald-400 text-[#071011] px-2.5 font-semibold hover:bg-emerald-300">
          <span>完成收口</span><ArrowRight size={11} />
        </Link>
      </div>
    );
  }
  if (item.kind === "recovery_active") {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5"><Zap size={14} className="text-amber-400 fill-amber-400/30" /><span className="font-semibold text-amber-200">精力恢复第 {item.stage || 1} 阶</span></div>
          <span className="font-mono text-[11px] text-amber-300/80">目标 {item.targetMinutes} 分钟</span>
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => { onClose(); onOpenRecovery?.(); }} className="flex h-7 items-center !gap-1 border border-amber-400/30 text-amber-200 hover:bg-amber-400/10 text-xs">
            <Zap size={11} /><span>恢复指引</span>
          </Button>
          <Link href="/today" onClick={onClose} className="flex h-7 items-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-zinc-200 hover:text-white text-xs font-medium">
            <span>今日行动</span><ArrowRight size={11} />
          </Link>
        </div>
      </div>
    );
  }
  if (item.kind === "evening_review_due") {
    return (
      <div className="rounded-lg border border-indigo-400/30 bg-indigo-400/10 p-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-1.5"><Moon size={14} className="text-indigo-300 fill-indigo-400/20" /><span className="font-semibold text-indigo-200">晚间复盘待收口</span></div>
        <Link href={item.reviewHref || "/roadmap/reviews/daily"} onClick={onClose} className="flex h-7 items-center gap-1 rounded bg-indigo-500/40 border border-indigo-400/40 text-indigo-100 px-2.5 font-semibold hover:bg-indigo-500/60 text-xs">
          <span>前往复盘</span><ArrowRight size={11} />
        </Link>
      </div>
    );
  }
  if (item.kind === "sync_issue") {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2"><AlertCircle size={14} className="text-amber-400" /><span className="font-semibold text-amber-200">离线数据待对账</span></div>
        <Button type="button" size="sm" variant="secondary" onClick={onRetrySync} className="flex h-7 items-center !gap-1 bg-amber-400/20 text-amber-200 hover:bg-amber-400/30 border-0 text-xs">
          <RefreshCw size={11} /><span>立即对账</span>
        </Button>
      </div>
    );
  }
  if (item.kind === "confirmations_pending") {
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5 text-xs flex items-center justify-between">
        <div className="flex items-center gap-2"><FileCheck2 size={14} className="text-amber-400" /><span className="font-semibold text-amber-200">{item.pendingConfirmationsCount || 1} 项待确认</span></div>
        <Button type="button" size="sm" variant="secondary" onClick={() => { onClose(); onOpenAction?.("confirmation-center"); }} className="flex h-7 items-center !gap-1 bg-amber-400/20 text-amber-200 hover:bg-amber-400/30 border-0 text-xs">
          <span>去确认</span><ArrowRight size={11} />
        </Button>
      </div>
    );
  }
  return null;
}
export function HubFlowStopwatchPanel(props: {
  activeItem?: DynamicIslandActiveItem;
  dominantState: DynamicIslandActiveItem;
  elapsedSeconds: number;
  isResuming: boolean;
  onDirectResume: (e?: React.MouseEvent) => void;
  onClose: () => void;
}) {
  const { activeItem, dominantState, elapsedSeconds, isResuming, onDirectResume, onClose } = props;
  const item = activeItem || dominantState;
  const session = item.session;

  if (session && (item.kind === "live_session_running" || item.kind === "activity_paused" || item.kind === "live_session_closing")) {
    const isRunning = item.kind === "live_session_running";
    const isPaused = item.kind === "activity_paused";

    return (
      <div className="flex flex-col gap-3 py-1">
        <div className="flex flex-col items-center justify-center py-2 text-center">
          <div className={`font-mono text-3xl font-bold tracking-tight tabular-nums ${
            isRunning ? "text-teal-300 drop-shadow-[0_0_16px_rgba(45,212,191,0.35)]" : isPaused ? "text-amber-200 drop-shadow-[0_0_16px_rgba(251,191,36,0.25)]" : "text-emerald-200"
          }`}>
            {formatClockDuration(elapsedSeconds)}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
            <span className="font-semibold text-white">{session.subjectName || "专注学习"}</span>
            <span>·</span>
            <span className={isRunning ? "text-teal-400" : isPaused ? "text-amber-400" : "text-emerald-400"}>
              {isRunning ? "🟢 深度专注中" : isPaused ? "🟡 专注已暂停" : "🏁 待收口沉淀"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {isPaused ? (
            <Button type="button" disabled={isResuming} onClick={onDirectResume} className="flex h-8 items-center justify-center !gap-1.5 rounded-lg !bg-teal-400 text-[#071011] !px-3 text-xs font-semibold shadow-[0_0_12px_rgba(45,212,191,0.25)] hover:!bg-teal-300">
              {isResuming ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} className="fill-current" />}<span>立即继续学习</span>
            </Button>
          ) : (
            <Link href={activitySourcePath(session)} onClick={onClose} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/10 hover:text-white transition-all">
              <Maximize2 size={13} /><span>全屏专注视图</span>
            </Link>
          )}
          <Link href={activitySourcePath(session)} onClick={onClose} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-teal-400/50 bg-teal-400 text-[#071011] px-3 text-xs font-semibold shadow-[0_0_12px_rgba(45,212,191,0.25)] hover:bg-teal-300 transition-all">
            <Square size={13} className="fill-current" /><span>前往结束收口</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-4 text-center">
      <div className="font-mono text-3xl font-bold tracking-tight text-zinc-600 tabular-nums">00:00:00</div>
      <div className="mt-1 text-xs text-zinc-400 font-medium">⚪ 当前未在专注学习中</div>
      <p className="mt-1 text-[11px] text-zinc-500 max-w-xs">选择任意科目即可开启沉浸式正向心流秒表，系统将全程守护备考节奏。</p>
      <div className="mt-3 grid grid-cols-2 gap-2 w-full max-w-xs">
        <Link href="/focus" onClick={onClose} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-teal-400/50 bg-teal-400 text-[#071011] px-3 text-xs font-semibold shadow-[0_0_12px_rgba(45,212,191,0.2)] hover:bg-teal-300 transition-all">
          <Play size={12} className="fill-current" /><span>开始新专注</span>
        </Link>
        <Link href="/today" onClick={onClose} className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/10 hover:text-white transition-all">
          <span>今日任务</span><ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}
export function HubConfirmationClosureGuide(props: {
  pendingConfirmationsCount?: number;
  eveningReview?: DynamicIslandEveningReviewProps | null;
  onOpenAction?: (action: GlobalCommandAction) => void;
  onClose: () => void;
}) {
  const { pendingConfirmationsCount = 0, eveningReview, onOpenAction, onClose } = props;

  return (
    <div className="flex flex-col gap-3 py-1 text-xs">
      {pendingConfirmationsCount > 0 ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><FileCheck2 size={15} className="text-amber-400" /><span className="font-semibold text-amber-200">待确认中心决策</span></div>
            <span className="rounded-full bg-amber-400/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-300">{pendingConfirmationsCount} 项待处理</span>
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-400 leading-relaxed">阶段建议、AI 报告、专项复测与模拟考试结果统一在此汇聚，等待你的最终审核与确认。</p>
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={() => { onClose(); onOpenAction?.("confirmation-center"); }}
              className="flex h-7 items-center !gap-1.5 rounded bg-amber-400 text-[#071011] !px-3 font-semibold hover:bg-amber-300 text-xs shadow-[0_0_8px_rgba(251,191,36,0.2)]"
            >
              <span>打开确认中心</span><ArrowRight size={11} />
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-indigo-400/30 bg-indigo-400/10 p-3">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2"><Moon size={15} className="text-indigo-300 fill-indigo-400/20" /><span className="font-semibold text-indigo-200">晚间收口指引</span></div>
          <span className="text-[11px] text-zinc-400 font-mono">20:00 每日闭环</span>
        </div>
        <div className="mt-2.5 space-y-1.5 rounded-md border border-white/5 bg-white/[0.02] p-2">
          <div className="flex items-center justify-between text-zinc-300">
            <span>最低有效行动</span>
            {eveningReview?.minimumActionDone ? (
              <span className="flex items-center gap-1 text-teal-300 font-medium"><CheckCircle2 size={12} />已达成</span>
            ) : (
              <span className="flex items-center gap-1 text-amber-300 font-medium"><AlertCircle size={12} />待完成</span>
            )}
          </div>
          <div className="flex items-center justify-between text-zinc-300">
            <span>今日每日复盘</span>
            {eveningReview?.dailyReviewDone ? (
              <span className="flex items-center gap-1 text-teal-300 font-medium"><CheckCircle2 size={12} />已提交</span>
            ) : (
              <span className="flex items-center gap-1 text-indigo-300 font-medium"><Clock3 size={12} />待沉淀</span>
            )}
          </div>
        </div>
        <div className="mt-2.5 flex justify-end">
          <Link
            href={eveningReview?.reviewHref || "/roadmap/reviews/daily"}
            onClick={onClose}
            className="flex h-7 items-center gap-1.5 rounded bg-indigo-500/30 border border-indigo-400/50 text-indigo-100 px-3 font-semibold hover:bg-indigo-500/40 transition-colors text-xs"
          >
            <span>前往每日复盘</span><ArrowRight size={11} />
          </Link>
        </div>
      </div>
    </div>
  );
}
export function HubCommandPaletteList(props: {
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
                isSelected ? "bg-teal-500/15 text-teal-200 ring-1 ring-teal-400/30 shadow-[0_0_8px_rgba(45,212,191,0.15)]" : "text-zinc-300 hover:bg-white/5"
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
                  <span>跳转</span><CornerDownLeft size={11} />
                </span>
              ) : null}
            </div>
          );
        })
      ) : (
        <div className="py-6 text-center text-xs text-zinc-500">未找到匹配的结果或命令</div>
      )}
    </div>
  );
}
function HubActivePanel(props: DynamicIslandHubProps) {
  const {
    viewMode, commands, selectedIndex, onSelectIndex, onExecuteCommand, activeStates,
    dominantState, elapsedSeconds, isResuming = false, onDirectResume, onOpenRecovery,
    onRetrySync, onOpenAction, onClose, eveningReview, pendingConfirmationsCount = 0,
  } = props;
  if (viewMode === "search") {
    return <HubCommandPaletteList commands={commands} selectedIndex={selectedIndex} onSelectIndex={onSelectIndex} onExecuteCommand={onExecuteCommand} />;
  }
  if (viewMode === "overview") {
    return <HubSupervisionOverview activeStates={activeStates} dominantState={dominantState} elapsedSeconds={elapsedSeconds} isResuming={isResuming} onDirectResume={onDirectResume} onOpenRecovery={onOpenRecovery} onRetrySync={onRetrySync} onOpenAction={onOpenAction} onClose={onClose} />;
  }
  if (viewMode === "focus") {
    return <HubFlowStopwatchPanel activeItem={activeStates.find((s) => s.session) || dominantState} dominantState={dominantState} elapsedSeconds={elapsedSeconds} isResuming={isResuming} onDirectResume={onDirectResume} onClose={onClose} />;
  }
  return <HubConfirmationClosureGuide pendingConfirmationsCount={pendingConfirmationsCount} eveningReview={eveningReview} onOpenAction={onOpenAction} onClose={onClose} />;
}

export function DynamicIslandHub(props: DynamicIslandHubProps) {
  const { viewMode, onViewModeChange, activeStates, eveningReview, pendingConfirmationsCount = 0 } = props;
  const hasRunningSession = activeStates.some((s) => s.kind === "live_session_running" || s.kind === "activity_paused");
  const eveningDue = Boolean(eveningReview?.due);

  return (
    <div className="w-full text-xs">
      <HubViewModeTabs
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        activeStatesCount={activeStates.filter((s) => s.kind !== "idle").length}
        hasRunningSession={hasRunningSession}
        pendingConfirmationsCount={pendingConfirmationsCount}
        eveningDue={eveningDue}
      />
      <div className="pt-0.5"><HubActivePanel {...props} /></div>
    </div>
  );
}
