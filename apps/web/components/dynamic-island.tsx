"use client";

import { useState, useRef, useEffect, useMemo, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Command, 
  Search, 
  X 
} from "lucide-react";
import { getTimerElapsedSeconds } from "@areaforge/core";
import { IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { 
  clampCommandIndex,
  GLOBAL_COMMANDS,
  filterGlobalCommands,
  getGlobalCommandHref,
  resolveGlobalCommand,
  type GlobalCommandAction,
  type GlobalCommandDefinition 
} from "@/lib/navigation/command-palette";
import { postStudySessionCommand } from "@/lib/api/session";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import { publishActivityStatus } from "@/lib/client/activity-status";
import {
  DynamicIslandCommandList,
  DynamicIslandHeroDrawer,
  getCapsuleGlowStyle,
} from "./dynamic-island-drawer";
import {
  CapsuleLeftSegment,
  CapsuleRightSegment,
  type CapsuleLeftSegmentProps,
  type CapsuleRightSegmentProps,
} from "./dynamic-island-segments";
import type { QuickReviewActivityClaim } from "@/lib/client/quick-review-activity";
import type { StudySessionDto } from "@/lib/contracts";
import type { FocusOfflineSyncState } from "@/lib/client/focus-offline-store";
import type { ShellSyncState } from "@/lib/client/app-shell-projection";

export {
  CapsuleLeftSegment,
  CapsuleRightSegment,
  type CapsuleLeftSegmentProps,
  type CapsuleRightSegmentProps,
};

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

export type DynamicIslandCapsuleKind =
  | "live_session_running"
  | "live_session_closing"
  | "activity_paused"
  | "recovery_active"
  | "evening_review_due"
  | "sync_issue"
  | "idle";

export type DynamicIslandSyncState = FocusOfflineSyncState | ShellSyncState;

export interface DynamicIslandRecoveryProps {
  active: boolean;
  stage: number;
  targetMinutes: number;
  reason?: string;
  onOpen?: () => void;
}

export interface DynamicIslandEveningReviewProps {
  due: boolean;
  minimumActionDone: boolean;
  dailyReviewDone: boolean;
  reviewHref?: string;
  onOpen?: () => void;
}

export interface DynamicIslandProps {
  userId: string;
  activeSession: StudySessionDto | null;
  offlineSession: StudySessionDto | null;
  quickReviewClaim: QuickReviewActivityClaim | null;
  syncState?: DynamicIslandSyncState;
  onRetrySync?: () => void;
  onOpenAction: (action: GlobalCommandAction) => void;
  compactOnNarrow?: boolean;
  commands?: readonly GlobalCommandDefinition[];
  recovery?: DynamicIslandRecoveryProps | null;
  eveningReview?: DynamicIslandEveningReviewProps | null;
  onResumeSession?: (sessionId: string) => Promise<void>;
}

export interface DynamicIslandCapsuleState {
  kind: DynamicIslandCapsuleKind;
  session?: StudySessionDto;
  elapsedSeconds?: number;
  stage?: number;
  targetMinutes?: number;
  reason?: string;
  minimumActionDone?: boolean;
  dailyReviewDone?: boolean;
  reviewHref?: string;
  syncState?: DynamicIslandSyncState;
}

export function resolveDynamicIslandState(input: {
  activeSession: StudySessionDto | null;
  offlineSession: StudySessionDto | null;
  syncState?: DynamicIslandSyncState;
  recovery?: DynamicIslandRecoveryProps | null;
  eveningReview?: DynamicIslandEveningReviewProps | null;
  elapsedSeconds: number;
}): DynamicIslandCapsuleState {
  const session = input.activeSession || input.offlineSession;

  if (session && session.status === "running") {
    return { kind: "live_session_running", session, elapsedSeconds: input.elapsedSeconds };
  }
  if (session && session.status === "closing") {
    return { kind: "live_session_closing", session, elapsedSeconds: input.elapsedSeconds };
  }
  if (session && session.status === "paused") {
    return { kind: "activity_paused", session, elapsedSeconds: input.elapsedSeconds };
  }
  if (input.recovery && input.recovery.active) {
    return {
      kind: "recovery_active",
      stage: input.recovery.stage || 1,
      targetMinutes: input.recovery.targetMinutes || 30,
      reason: input.recovery.reason,
    };
  }
  if (input.eveningReview && input.eveningReview.due) {
    return {
      kind: "evening_review_due",
      minimumActionDone: input.eveningReview.minimumActionDone,
      dailyReviewDone: input.eveningReview.dailyReviewDone,
      reviewHref: input.eveningReview.reviewHref || "/roadmap/reviews/daily",
    };
  }
  if (input.syncState && input.syncState !== "current") {
    return { kind: "sync_issue", syncState: input.syncState };
  }
  return { kind: "idle" };
}

export function DynamicIsland(props: DynamicIslandProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isResuming, setIsResuming] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const now = useSyncExternalStore(subscribeNow, getNowSnapshot, getServerNowSnapshot);

  const session = props.activeSession || props.offlineSession;

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

  const capsuleState = useMemo(
    () =>
      resolveDynamicIslandState({
        activeSession: props.activeSession,
        offlineSession: props.offlineSession,
        syncState: props.syncState,
        recovery: props.recovery,
        eveningReview: props.eveningReview,
        elapsedSeconds,
      }),
    [props.activeSession, props.offlineSession, props.syncState, props.recovery, props.eveningReview, elapsedSeconds]
  );

  const commands = useMemo(() => filterGlobalCommands(query, props.commands ?? GLOBAL_COMMANDS), [props.commands, query]);
  const selectedIndex = clampCommandIndex(activeIndex, commands.length);

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

  async function handleDirectResume(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!session?.id || isResuming) return;
    setIsResuming(true);
    try {
      if (props.onResumeSession) {
        await props.onResumeSession(session.id);
      } else {
        const response = await postStudySessionCommand(session.id, "resume", {}, getClientDeviceHeaders());
        if (response.ok && response.body?.session) {
          publishActivityStatus(props.userId, response.body.session);
        }
      }
    } catch (err) {
      console.error("Failed to resume session from Dynamic Island", err);
    } finally {
      setIsResuming(false);
    }
  }

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
  const containerGlowClass = getCapsuleGlowStyle(capsuleState.kind, isOpen);

  return (
    <div
      ref={containerRef}
      className="relative mx-auto flex h-9 w-full min-w-0 max-w-[32rem] items-center justify-center z-[var(--af-layer-modal)]"
    >
      <div
        className={`absolute top-0 left-0 right-0 overflow-hidden border bg-[#090e12]/98 shadow-2xl backdrop-blur-2xl transition-[border-radius,box-shadow,border-color,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen
            ? "rounded-[20px] border-teal-500/40 shadow-[0_0_32px_rgba(45,212,191,0.18)] ring-1 ring-white/10"
            : `rounded-[18px] cursor-pointer ${containerGlowClass}`
        }`}
        onClick={!isOpen ? triggerFocusAndOpen : undefined}
      >
        <div className="flex h-9 w-full min-w-0 items-center justify-between gap-2 px-3 text-xs">
          <CapsuleLeftSegment
            capsuleState={capsuleState}
            onTriggerOpen={triggerFocusAndOpen}
          />

          <div className="flex flex-1 min-w-0 items-center gap-1.5 px-1">
            <Search size={13} className="shrink-0 text-zinc-500" />
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
              placeholder={
                capsuleState.kind === "live_session_running"
                  ? "搜索命令…"
                  : capsuleState.kind !== "idle"
                  ? "搜索或输入命令…"
                  : "搜索或输入命令… ⌘K"
              }
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
            ) : capsuleState.kind === "idle" ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 shrink-0">
                <Command size={11} />K
              </span>
            ) : null}
          </div>

          <CapsuleRightSegment
            capsuleState={capsuleState}
            isOpen={isOpen}
            isResuming={isResuming}
            elapsedSeconds={elapsedSeconds}
            onTriggerOpen={triggerFocusAndOpen}
            onDirectResume={handleDirectResume}
            onRetrySync={props.onRetrySync}
            onCloseDrawer={() => setIsOpen(false)}
          />
        </div>

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
              {!isTypingSearch && capsuleState.kind !== "idle" ? (
                <DynamicIslandHeroDrawer
                  capsuleState={capsuleState}
                  elapsedSeconds={elapsedSeconds}
                  isResuming={isResuming}
                  onDirectResume={handleDirectResume}
                  onOpenRecovery={props.recovery?.onOpen ?? (() => props.onOpenAction("recovery-help"))}
                  onCloseDrawer={() => setIsOpen(false)}
                />
              ) : (
                <DynamicIslandCommandList
                  commands={commands}
                  selectedIndex={selectedIndex}
                  onSelectIndex={setActiveIndex}
                  onExecuteCommand={executeCommand}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

