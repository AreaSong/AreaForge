"use client";

import { useState, useRef, useEffect, useMemo, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Clock3, 
  Command, 
  CornerDownLeft, 
  Maximize2, 
  RefreshCw, 
  Search, 
  Square, 
  X 
} from "lucide-react";
import { formatClockDuration } from "@/lib/formatters";
import { getTimerElapsedSeconds } from "@areaforge/core";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { activitySourcePath } from "@/lib/navigation/activity-route";
import { 
  clampCommandIndex,
  GLOBAL_COMMANDS,
  filterGlobalCommands,
  getGlobalCommandHref,
  resolveGlobalCommand,
  type GlobalCommandAction,
  type GlobalCommandDefinition 
} from "@/lib/navigation/command-palette";
import type { QuickReviewActivityClaim } from "@/lib/client/quick-review-activity";
import type { StudySessionDto } from "@/lib/contracts";
import type { FocusOfflineSyncState } from "@/lib/client/focus-offline-store";

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
  commands?: readonly GlobalCommandDefinition[];
}

export function DynamicIsland(props: DynamicIslandProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const now = useSyncExternalStore(subscribeNow, getNowSnapshot, getServerNowSnapshot);

  const session = props.activeSession || props.offlineSession;
  const hasSyncIssue = props.syncState && props.syncState !== "current";
  const isFocusing = Boolean(session && (session.status === "running" || session.status === "paused" || session.status === "closing"));

  // Calculate elapsed time
  const elapsedSeconds = session
    ? getTimerElapsedSeconds({
        status: session.status === "running" ? "running" : session.status === "paused" ? "paused" : "completed",
        startedAt: new Date(session.startedAt),
        pausedAt: session.pausedAt ? new Date(session.pausedAt) : undefined,
        endedAt: session.endedAt ? new Date(session.endedAt) : undefined,
        accumulatedPauseSeconds: session.accumulatedPauseSeconds,
        now: new Date(now),
      })
    : 0;

  // Filter commands
  const commands = useMemo(() => filterGlobalCommands(query, props.commands ?? GLOBAL_COMMANDS), [props.commands, query]);
  const selectedIndex = clampCommandIndex(activeIndex, commands.length);

  // Global shortcut Command+K & Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        setIsOpen(false);
        inputRef.current?.blur();
        setQuery("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Close when clicked outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  function executeCommand(command: GlobalCommandDefinition) {
    const resolved = resolveGlobalCommand(query, props.commands ?? GLOBAL_COMMANDS);
    const execution = resolved?.definition.id === command.id
      ? resolved.execution
      : { rawQuery: query, argumentText: "", args: [], namedArgs: {} };
    const href = getGlobalCommandHref(command, execution);
    if (href) router.push(href);
    if (command.action) props.onOpenAction(command.action);
    setIsOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function handleInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (commands.length ? (prev + 1) % commands.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (commands.length ? (prev - 1 + commands.length) % commands.length : 0));
    } else if (e.key === "Enter" && commands[selectedIndex]) {
      e.preventDefault();
      executeCommand(commands[selectedIndex]);
    }
  }

  function triggerFocusAndOpen() {
    setIsOpen(true);
    inputRef.current?.focus();
  }

  const isTypingSearch = Boolean(query.trim());

  return (
    /* Top fixed anchor: Guarantees 36px height & 32rem width stability */
    <div
      ref={containerRef}
      className="relative mx-auto flex h-9 w-full min-w-0 max-w-[32rem] items-center justify-center z-[var(--af-layer-modal)]"
    >
      {/* 
        Ultra-Smooth Morphing Drawer Shell:
        - Completely seamless obsidian glass body
        - Zero conflicting internal divider lines
      */}
      <div
        className={`absolute top-0 left-0 right-0 overflow-hidden border bg-[#090e12]/98 shadow-2xl backdrop-blur-2xl transition-[border-radius,box-shadow,border-color,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen
            ? "rounded-[20px] border-teal-500/40 shadow-[0_0_32px_rgba(45,212,191,0.18)] ring-1 ring-white/10"
            : `rounded-[18px] cursor-pointer ${
                isFocusing
                  ? "border-teal-500/35 shadow-[0_0_16px_rgba(45,212,191,0.12)] hover:border-teal-400/50"
                  : hasSyncIssue
                  ? "border-amber-400/35 shadow-[0_0_16px_rgba(251,191,36,0.12)] hover:border-amber-400/50"
                  : "border-white/10 hover:border-teal-400/30 hover:bg-white/[0.04]"
              }`
        }`}
        onClick={!isOpen ? triggerFocusAndOpen : undefined}
      >
        {/* 
          1. PERMANENT TOP CAPSULE ROW
        */}
        <div className="flex h-9 w-full min-w-0 items-center justify-between gap-2 px-3 text-xs">
          {/* Left Segment: Task Subject Pill */}
          {isFocusing && session ? (
            <div
              onClick={triggerFocusAndOpen}
              className="flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-white hover:text-teal-200 transition-colors border-r border-white/10 cursor-pointer select-none"
              title="点击聚焦搜索"
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
          ) : hasSyncIssue ? (
            <div 
              onClick={triggerFocusAndOpen}
              className="flex shrink-0 items-center gap-1.5 pr-2.5 text-xs text-amber-200 border-r border-white/10 cursor-pointer select-none"
            >
              <span className="size-2 shrink-0 rounded-full bg-amber-400 animate-pulse" />
              <span className="max-w-24 truncate">离线待对账</span>
            </div>
          ) : null}

          {/* Center Segment: Real Persistent Input without any internal box */}
          <div className="flex flex-1 min-w-0 items-center gap-2 px-1.5">
            <Search size={14} className="shrink-0 text-zinc-500" />
            <Input
              ref={inputRef}
              type="text"
              value={query}
              onFocus={() => setIsOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
                if (!isOpen) setIsOpen(true);
              }}
              onKeyDown={handleInputKeyDown}
              placeholder="搜索或输入命令…"
              className="af-island-input !h-auto !min-h-0 !border-0 !bg-transparent !p-0 text-xs text-white placeholder:text-zinc-500 !ring-0 !shadow-none !outline-none focus:!border-0 focus:!ring-0 focus-visible:!outline-none selection:bg-teal-500/30"
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
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="!h-5 !w-5 !p-0.5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={13} />
              </IconButton>
            ) : (
              <span className="inline-flex items-center gap-0.5 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 shrink-0">
                <Command size={11} />K
              </span>
            )}
          </div>

          {/* Right Segment */}
          {isFocusing && session ? (
            <div
              onClick={triggerFocusAndOpen}
              className="flex shrink-0 items-center gap-1.5 pl-2.5 text-xs font-medium border-l border-white/10 hover:text-teal-100 transition-colors cursor-pointer select-none"
              title={isOpen ? "当前学习状态" : "点击聚焦搜索"}
            >
              {isOpen ? (
                /* Expanded state: Status Label */
                <span className="inline-flex items-center gap-1.5 text-teal-300 font-semibold">
                  <span
                    className={`size-1.5 rounded-full ${
                      session.status === "running"
                        ? "bg-teal-400 animate-pulse"
                        : session.status === "closing"
                        ? "bg-emerald-400"
                        : "bg-amber-400"
                    }`}
                  />
                  <span>
                    {session.status === "running" ? "正在学习" : session.status === "closing" ? "待收口" : "已暂停"}
                  </span>
                </span>
              ) : (
                /* Collapsed state: Real-time clock duration */
                <span className="inline-flex items-center gap-1.5 font-mono font-bold text-teal-300 tabular-nums">
                  <Clock3 size={13} className="text-teal-400 shrink-0" />
                  <span>{formatClockDuration(elapsedSeconds)}</span>
                </span>
              )}
            </div>
          ) : hasSyncIssue && props.syncState === "deferred" && props.onRetrySync ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                props.onRetrySync?.();
              }}
              className="flex shrink-0 items-center !gap-1 !h-auto rounded bg-amber-400/20 !px-2 !py-0.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-400/30 !border-0 border-l border-white/10 cursor-pointer"
              leftIcon={<RefreshCw size={11} className="animate-spin" />}
            >
              <span>对账</span>
            </Button>
          ) : null}
        </div>

        {/* 
          2. PULL-DOWN CONTENT DRAWER
          - Removed harsh border-t to eliminate misalignment with top bar's bottom border
        */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
          }`}
        >
          <div className="overflow-hidden">
            <div
              className={`px-3 pb-3 pt-2 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isOpen ? "translate-y-0" : "-translate-y-2"
              }`}
            >
              {!isTypingSearch && isFocusing && session ? (
                /* Sub-case 1: Pulled-down Hero Focus Card (Untyped) */
                <div className="flex flex-col gap-2.5">
                  {/* Clean Big Time Display */}
                  <div className="flex flex-col items-center justify-center py-2 text-center">
                    <div className="font-mono text-3xl font-bold tracking-tight text-white tabular-nums drop-shadow-[0_0_16px_rgba(45,212,191,0.3)]">
                      {formatClockDuration(elapsedSeconds)}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400">
                      <span className="font-medium text-teal-400">
                        {session.status === "running" ? "🟢 深度专注中" : session.status === "closing" ? "🏁 待收口沉淀" : "🟡 已暂停"}
                      </span>
                      <span>·</span>
                      <span>⏱️ 正向心流计时</span>
                    </div>
                  </div>

                  {/* Clean Action Buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href={activitySourcePath(session)}
                      onClick={() => setIsOpen(false)}
                      className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200 hover:bg-white/10 hover:text-white transition-all"
                    >
                      <Maximize2 size={13} />
                      <span>全屏专注视图</span>
                    </Link>
                    <Link
                      href={activitySourcePath(session)}
                      onClick={() => setIsOpen(false)}
                      className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-teal-400/50 bg-teal-400 text-[#071011] px-3 text-xs font-semibold shadow-[0_0_12px_rgba(45,212,191,0.25)] hover:bg-teal-300 transition-all"
                    >
                      <Square size={13} className="fill-current" />
                      <span>前往结束收口</span>
                    </Link>
                  </div>
                </div>
              ) : (
                /* Sub-case 2: Pulled-down Search Results List (Typed or Idle) */
                <div className="max-h-60 overflow-y-auto space-y-0.5 focus-scrollbar pt-1">
                  {commands.length > 0 ? (
                    commands.map((cmd, idx) => {
                      const isSelected = idx === selectedIndex;
                      return (
                        <div
                          key={cmd.id}
                          onClick={() => executeCommand(cmd)}
                          onMouseEnter={() => setActiveIndex(idx)}
                          className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                            isSelected
                              ? "bg-teal-500/15 text-teal-200 ring-1 ring-teal-400/30"
                              : "text-zinc-300 hover:bg-white/5"
                          }`}
                          role="option"
                          aria-selected={isSelected}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="font-medium text-white truncate">{cmd.label}</span>
                            <span className="hidden sm:inline text-[11px] text-zinc-500 truncate">
                              {cmd.description}
                            </span>
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
                    <div className="py-5 text-center text-xs text-zinc-500">
                      未找到匹配的结果或命令
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
