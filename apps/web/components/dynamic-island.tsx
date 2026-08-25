"use client";

import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { 
  Clock3, 
  ChevronDown, 
  Flame, 
  Maximize2, 
  RefreshCw, 
  Square, 
  X 
} from "lucide-react";
import { formatClockDuration } from "@/lib/formatters";
import { getTimerElapsedSeconds } from "@areaforge/core";
import { activitySourcePath } from "@/lib/navigation/activity-route";
import type { GlobalCommandAction } from "@/lib/navigation/command-palette";
import type { QuickReviewActivityClaim } from "@/lib/client/quick-review-activity";
import type { StudySessionDto } from "@/lib/contracts";
import type { FocusOfflineSyncState } from "@/lib/client/focus-offline-store";
import { GlobalCommandPalette } from "./global-command-palette";

const serverNowSnapshot = 0;
let nowSnapshot = serverNowSnapshot;
let nowTimer: number | null = null;
const nowListeners = new Set<() => void>();

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (nowTimer === null && typeof window !== "undefined") {
    nowSnapshot = Date.now();
    listener();
    nowTimer = window.setInterval(() => {
      nowSnapshot = Date.now();
      for (const currentListener of nowListeners) currentListener();
    }, 1_000);
  }
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0 && nowTimer !== null) {
      window.clearInterval(nowTimer);
      nowTimer = null;
    }
  };
}

function getNowSnapshot(): number {
  return nowSnapshot;
}

function getServerNowSnapshot(): number {
  return serverNowSnapshot;
}

export interface DynamicIslandProps {
  userId: string;
  activeSession: StudySessionDto | null;
  offlineSession: StudySessionDto | null;
  quickReviewClaim: QuickReviewActivityClaim | null;
  syncState?: FocusOfflineSyncState;
  onRetrySync?: () => void;
  onOpenAction: (action: GlobalCommandAction) => void;
  compactOnNarrow?: boolean;
}

export function DynamicIsland(props: DynamicIslandProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const now = useSyncExternalStore(subscribeNow, getNowSnapshot, getServerNowSnapshot);

  const session = props.activeSession || props.offlineSession;
  const hasSyncIssue = props.syncState && props.syncState !== "current";

  // Calculate elapsed time
  const elapsedSeconds = session
    ? getTimerElapsedSeconds({
        status: session.status === "running" ? "running" : session.status === "paused" ? "paused" : "completed",
        startedAt: new Date(session.startedAt),
        pausedAt: session.pausedAt ? new Date(session.pausedAt) : undefined,
        endedAt: session.endedAt ? new Date(session.endedAt) : undefined,
        accumulatedPauseSeconds: session.accumulatedPauseSeconds,
        now: new Date(now || Date.now()),
      })
    : 0;

  // Close popover on outside click or escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  // Determine Island Mode
  const isFocusing = Boolean(session && (session.status === "running" || session.status === "paused" || session.status === "closing"));

  return (
    <div className="relative mx-auto flex w-full min-w-0 max-w-[42rem] items-center justify-center" ref={popoverRef}>
      {/* Dynamic Pill Container */}
      <div className="flex w-full min-w-0 items-center justify-center transition-all duration-300 ease-out">
        {/* State A: Sync Issue / Notice Alert */}
        {hasSyncIssue && !isFocusing ? (
          <div className="flex h-9 w-full min-w-0 items-center justify-between gap-2.5 rounded-full border border-amber-400/35 bg-[#14120a] px-3.5 text-xs text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.12)] transition-all">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-2 shrink-0 rounded-full bg-amber-400 animate-pulse" />
              <span className="truncate text-xs font-medium text-amber-200">
                {props.syncState === "offline"
                  ? "当前离线：计时已保存在本地，联网自动同步"
                  : props.syncState === "blocked"
                  ? "状态冲突：请先比较差异处理离线记录"
                  : props.syncState === "deferred"
                  ? "离线记录已保留：等待你显式重新对账"
                  : "待同步操作：服务端确认前不会伪造完成"}
              </span>
            </div>
            {props.syncState === "deferred" && props.onRetrySync ? (
              <button
                type="button"
                onClick={props.onRetrySync}
                className="flex shrink-0 items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-400/30 transition-colors"
              >
                <RefreshCw size={11} className="animate-spin" />
                <span>重新对账</span>
              </button>
            ) : null}
          </div>
        ) : isFocusing && session ? (
          /* State B: Active Focus Heartbeat Island (High Focus State) */
          <div
            className={`group relative flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-full border px-3 text-xs shadow-lg transition-all duration-300 ${
              session.status === "running"
                ? "border-teal-400/50 bg-[#071314]/90 text-teal-100 shadow-[0_0_20px_rgba(45,212,191,0.18)]"
                : session.status === "closing"
                ? "border-emerald-400/50 bg-[#081512]/90 text-emerald-100 shadow-[0_0_16px_rgba(52,211,153,0.15)]"
                : "border-amber-400/45 bg-[#15120a]/90 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.15)]"
            }`}
          >
            {/* Left: Status Dot + Subject Badge */}
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="flex min-w-0 items-center gap-2 text-left focus:outline-none"
              title="点击展开专注控制微岛"
            >
              <span
                className={`flex size-2 shrink-0 rounded-full ${
                  session.status === "running"
                    ? "bg-teal-400 animate-pulse"
                    : session.status === "closing"
                    ? "bg-emerald-400"
                    : "bg-amber-400"
                }`}
              />
              <span className="hidden sm:inline text-[11px] font-medium opacity-80">
                {session.status === "running" ? "心流" : session.status === "closing" ? "待收口" : "暂停"}
              </span>
              <span className="max-w-28 sm:max-w-40 truncate font-semibold text-white tracking-tight">
                {session.subjectName}
              </span>
            </button>

            {/* Center: Live Tabular Clock Duration */}
            <Link
              href={activitySourcePath(session)}
              className="flex items-center gap-1.5 font-mono text-xs sm:text-sm font-bold tracking-tight text-white hover:text-teal-300 transition-colors"
              title="进入全屏专注工作区"
            >
              <span className="tabular-nums">{formatClockDuration(elapsedSeconds)}</span>
              {session.status === "running" ? (
                <span className="flex gap-0.5 items-end h-2.5" aria-hidden="true">
                  <span className="w-0.5 bg-teal-400 rounded-full animate-[sound-bar_0.8s_ease-in-out_infinite_alternate]" />
                  <span className="w-0.5 bg-teal-400 rounded-full animate-[sound-bar_0.6s_ease-in-out_0.2s_infinite_alternate]" />
                  <span className="w-0.5 bg-teal-400 rounded-full animate-[sound-bar_0.9s_ease-in-out_0.4s_infinite_alternate]" />
                </span>
              ) : null}
            </Link>

            {/* Right: Quick Actions */}
            <div className="flex items-center gap-1 shrink-0">
              <Link
                href={activitySourcePath(session)}
                className="flex size-7 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-colors"
                title="回到大表盘视图"
              >
                <Maximize2 size={13} />
              </Link>
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                className="flex size-7 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-colors"
                title="展开微控制台"
                aria-expanded={menuOpen}
              >
                <ChevronDown size={14} className={`transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`} />
              </button>
            </div>
          </div>
        ) : (
          /* State C: Default Idle Search Capsule */
          <GlobalCommandPalette
            trigger={<span className="text-zinc-500">搜索或输入命令…</span>}
            triggerLabel="打开全局搜索和命令面板"
            onOpenAction={props.onOpenAction}
            compactOnNarrow={props.compactOnNarrow}
          />
        )}
      </div>

      {/* Expanded Island Popover Micro-Console */}
      {menuOpen && session ? (
        <div className="absolute top-11 z-[var(--af-layer-shell-popover)] w-full max-w-md animate-[scale-in_0.2s_cubic-bezier(0.16,1,0.3,1)] rounded-2xl border border-white/15 bg-[#0b1014]/95 p-5 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
                <Flame size={15} />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">{session.subjectName}</p>
                <p className="text-[11px] text-zinc-400">{session.taskTitle ?? "自由沉浸学习"}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              <X size={14} />
            </button>
          </div>

          {/* Time & Session Fact Highlight */}
          <div className="mt-4 rounded-xl border border-teal-500/20 bg-teal-500/5 p-3.5 text-center">
            <p className="text-[11px] font-medium text-teal-300">已专注时长</p>
            <p className="mt-0.5 font-mono text-3xl font-bold text-white tabular-nums tracking-tight">
              {formatClockDuration(elapsedSeconds)}
            </p>
            <div className="mt-2 flex items-center justify-center gap-4 text-[11px] text-zinc-400">
              <span className="flex items-center gap-1">
                <Clock3 size={12} /> 状态：{session.status === "running" ? "正向心流" : session.status === "closing" ? "待收口" : "已暂停"}
              </span>
              {props.syncState && props.syncState !== "current" ? (
                <span className="text-amber-300">· 离线记录待同步</span>
              ) : null}
            </div>
          </div>

          {/* Quick Actions Grid */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link
              href={activitySourcePath(session)}
              onClick={() => setMenuOpen(false)}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-medium text-white hover:bg-white/10 transition-colors"
            >
              <Maximize2 size={13} />
              <span>全屏专注视图</span>
            </Link>

            <Link
              href={activitySourcePath(session)}
              onClick={() => setMenuOpen(false)}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-teal-400 py-2.5 text-xs font-bold text-[#061012] shadow-[0_0_16px_rgba(45,212,191,0.3)] hover:bg-teal-300 transition-colors"
            >
              <Square size={13} className="fill-current" />
              <span>前往结束收口</span>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
