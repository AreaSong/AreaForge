"use client";

import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { getTimerElapsedSeconds } from "@areaforge/core";
import {
  clampCommandIndex,
  GLOBAL_COMMANDS,
  filterGlobalCommands,
  getGlobalCommandHref,
  resolveGlobalCommand,
  type GlobalCommandAction,
  type GlobalCommandDefinition,
} from "@/lib/navigation/command-palette";
import { postStudySessionCommand } from "@/lib/api/session";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import { publishActivityStatus } from "@/lib/client/activity-status";
import {
  DynamicIslandHub,
  HubSupervisionOverview,
  HubFlowStopwatchPanel,
  HubConfirmationClosureGuide,
  HubCommandPaletteList,
  HubViewModeTabs,
  type HubViewMode,
  type DynamicIslandHubProps,
} from "./dynamic-island-hub";
import {
  DynamicIslandCommandList,
  DynamicIslandHeroDrawer,
} from "./dynamic-island-drawer";
import {
  getCapsuleGlowStyle,
  getCapsuleGlowClass,
  getCapsuleInlineStyle,
  getToneFromCapsuleKind,
  getCapsuleToneColors,
  TONE_COLOR_SPECS,
  type ToneColorSpec,
} from "./dynamic-island-glow";
import {
  CapsuleBreathingDots,
  CapsuleLeftSegment,
  CapsuleCenterSegment,
  CapsuleRightSegment,
  type CapsuleBreathingDotsProps,
  type CapsuleLeftSegmentProps,
  type CapsuleCenterSegmentProps,
  type CapsuleRightSegmentProps,
} from "./dynamic-island-segments";
import {
  useDynamicIslandTicker,
  getNextTickerIndex,
  getPrevTickerIndex,
  clampTickerIndex,
  computeBreathingPagination,
  isTickerP0Pinned,
  isTickerRotationEnabled,
  computeTickerNextState,
  computePaginationDots,
  generatePaginationDots,
  formatDotsText,
  resolveTickerCurrentItem,
  TICKER_INTERVAL_MS,
  DEFAULT_TICKER_INTERVAL_MS,
  TICKER_RESUME_GRACE_MS,
  DEFAULT_RESUME_GRACE_MS,
  type BreathingPaginationDot,
  type DynamicIslandPaginationDot,
  type UseDynamicIslandTickerOptions,
  type UseDynamicIslandTickerResult,
} from "./dynamic-island-ticker";
import type { QuickReviewActivityClaim } from "@/lib/client/quick-review-activity";
import type { StudySessionDto } from "@/lib/contracts";
import {
  type DynamicIslandCapsuleKind,
  type DynamicIslandSyncState,
  type DynamicIslandTone,
  type DynamicIslandRecoveryProps,
  type DynamicIslandEveningReviewProps,
  type DynamicIslandQuickAction,
  type DynamicIslandActiveItem,
  type DynamicIslandStatePool,
  type CollectDynamicIslandStatesInput,
  type DynamicIslandStateEngineInput,
  type DynamicIslandCapsuleState,
  PRIORITY_WEIGHTS,
  IDLE_STATE_ITEM,
} from "./dynamic-island-types";
import {
  clampTimerDuration,
  getPriorityWeight,
  createIdleStateItem,
  collectDynamicIslandActiveStates,
  sortActiveStatesByPriority,
  getDominantState,
  resolveDominantState,
  computeDynamicIslandStatePool,
  collectDynamicIslandStatePool,
  validateStatePoolInvariants,
  resolveDynamicIslandState,
} from "./dynamic-island-state-engine";

export {
  DynamicIslandHub, HubSupervisionOverview, HubFlowStopwatchPanel, HubConfirmationClosureGuide,
  HubCommandPaletteList, HubViewModeTabs, DynamicIslandHeroDrawer, DynamicIslandCommandList,
  CapsuleBreathingDots, CapsuleLeftSegment, CapsuleCenterSegment, CapsuleRightSegment,
  getCapsuleGlowStyle, getCapsuleGlowClass, getCapsuleInlineStyle, getToneFromCapsuleKind,
  getCapsuleToneColors, TONE_COLOR_SPECS, useDynamicIslandTicker, getNextTickerIndex,
  getPrevTickerIndex, clampTickerIndex, computeBreathingPagination, isTickerP0Pinned,
  isTickerRotationEnabled, computeTickerNextState, computePaginationDots, generatePaginationDots,
  formatDotsText, resolveTickerCurrentItem, TICKER_INTERVAL_MS, DEFAULT_TICKER_INTERVAL_MS,
  TICKER_RESUME_GRACE_MS, DEFAULT_RESUME_GRACE_MS, clampTimerDuration, getPriorityWeight,
  createIdleStateItem, collectDynamicIslandActiveStates, sortActiveStatesByPriority,
  getDominantState, resolveDominantState, computeDynamicIslandStatePool, collectDynamicIslandStatePool,
  validateStatePoolInvariants, resolveDynamicIslandState, PRIORITY_WEIGHTS, IDLE_STATE_ITEM,
};

export type {
  HubViewMode, DynamicIslandHubProps, CapsuleBreathingDotsProps, CapsuleLeftSegmentProps,
  CapsuleCenterSegmentProps, CapsuleRightSegmentProps, ToneColorSpec, BreathingPaginationDot,
  DynamicIslandPaginationDot, UseDynamicIslandTickerOptions, UseDynamicIslandTickerResult,
  DynamicIslandCapsuleKind, DynamicIslandSyncState, DynamicIslandTone, DynamicIslandRecoveryProps,
  DynamicIslandEveningReviewProps, DynamicIslandQuickAction, DynamicIslandActiveItem,
  DynamicIslandStatePool, CollectDynamicIslandStatesInput, DynamicIslandStateEngineInput,
  DynamicIslandCapsuleState,
};

export const DYNAMIC_ISLAND_SEARCH_PLACEHOLDER = "搜索或输入命令… ⌘K";

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

function getNowSnapshot(): number { return nowSnapshot; }
function getServerNowSnapshot(): number { return serverNowSnapshot; }

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
  confirmationsCount?: number;
  pendingConfirmationsCount?: number;
}

function useDynamicIslandKeyboard(
  isOpen: boolean,
  setIsOpen: (open: boolean) => void,
  setViewMode: (mode: HubViewMode) => void,
  setQuery: (query: string) => void,
  inputRef: React.RefObject<HTMLInputElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen(true);
        setViewMode("search");
        inputRef.current?.focus();
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
  }, [isOpen, setIsOpen, setViewMode, setQuery, inputRef]);

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
  }, [isOpen, setIsOpen, setQuery, containerRef]);
}

function useDynamicIslandElapsed(
  activeSession: StudySessionDto | null,
  offlineSession: StudySessionDto | null
): { session: StudySessionDto | null; elapsedSeconds: number } {
  const now = useSyncExternalStore(subscribeNow, getNowSnapshot, getServerNowSnapshot);
  const session = activeSession || offlineSession;

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

  return { session, elapsedSeconds };
}

function resolveOverviewMode(kind: DynamicIslandCapsuleKind): HubViewMode {
  if (kind === "live_session_running" || kind === "activity_paused" || kind === "live_session_closing") {
    return "focus";
  }
  if (kind === "evening_review_due" || kind === "confirmations_pending") {
    return "closure";
  }
  return "overview";
}

function useDynamicIslandHandlers(
  query: string,
  setQuery: (q: string) => void,
  commands: readonly GlobalCommandDefinition[],
  selectedIndex: number,
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>,
  setIsOpen: (o: boolean) => void,
  setViewMode: (m: HubViewMode) => void,
  inputRef: React.RefObject<HTMLInputElement | null>,
  onOpenAction: (a: GlobalCommandAction) => void
) {
  const router = useRouter();

  function executeCommand(command: GlobalCommandDefinition) {
    const resolved = resolveGlobalCommand(query, commands);
    const execution = resolved?.definition.id === command.id
      ? resolved.execution : { rawQuery: query, argumentText: "", args: [], namedArgs: {} };
    const href = getGlobalCommandHref(command, execution);
    if (href) router.push(href);
    if (command.action) onOpenAction(command.action);
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

  return { executeCommand, handleInputKeyDown };
}

function useDirectResumeSession(
  userId: string,
  currentItem: DynamicIslandActiveItem,
  session: StudySessionDto | null,
  onResumeSession?: (id: string) => Promise<void>
) {
  const [isResuming, setIsResuming] = useState(false);

  async function handleDirectResume(e?: React.MouseEvent) {
    e?.stopPropagation();
    const resumeSession = currentItem.session || session;
    if (!resumeSession?.id || isResuming) return;
    setIsResuming(true);
    try {
      if (onResumeSession) {
        await onResumeSession(resumeSession.id);
      } else {
        const res = await postStudySessionCommand(resumeSession.id, "resume", {}, getClientDeviceHeaders());
        if (res.ok && res.body?.session) publishActivityStatus(userId, res.body.session);
      }
    } finally {
      setIsResuming(false);
    }
  }

  return { isResuming, handleDirectResume };
}

function DynamicIslandCollapsedBar(props: {
  currentItem: DynamicIslandActiveItem;
  tickerTotalStates: number;
  tickerCurrentIndex: number;
  query: string;
  onQueryChange: (q: string) => void;
  onOpenSearch: () => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  onClearQuery: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isOpen: boolean;
  isResuming: boolean;
  elapsedSeconds: number;
  onOpenOverview: (e?: React.MouseEvent) => void;
  onOpenFocus: (e?: React.MouseEvent) => void;
  onDirectResume: (e?: React.MouseEvent) => Promise<void>;
  onRetrySync?: () => void;
  onCloseDrawer: () => void;
}) {
  return (
    <div className="flex h-9 w-full min-w-0 items-center justify-between gap-2 px-3 text-xs">
      <CapsuleLeftSegment
        activeItem={props.currentItem}
        activeCount={props.tickerTotalStates}
        tickerIndex={props.tickerCurrentIndex}
        onOpenOverview={props.onOpenOverview}
        onTriggerOpen={props.onOpenOverview}
      />
      <CapsuleCenterSegment
        query={props.query}
        onQueryChange={props.onQueryChange}
        onOpenSearch={props.onOpenSearch}
        onKeyDown={props.onKeyDown}
        onClearQuery={props.onClearQuery}
        inputRef={props.inputRef}
        activeKind={props.currentItem.kind}
      />
      <CapsuleRightSegment
        activeItem={props.currentItem}
        isOpen={props.isOpen}
        isResuming={props.isResuming}
        elapsedSeconds={props.elapsedSeconds}
        onTriggerOpen={props.onOpenOverview}
        onOpenFocus={props.onOpenFocus}
        onDirectResume={props.onDirectResume}
        onRetrySync={props.onRetrySync}
        onCloseDrawer={props.onCloseDrawer}
      />
    </div>
  );
}

function DynamicIslandExpandedFold(props: {
  isOpen: boolean;
  hubProps: DynamicIslandHubProps;
}) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        props.isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
      }`}
    >
      <div className="overflow-hidden">
        <div
          className={`px-3 pb-3 pt-2 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            props.isOpen ? "translate-y-0" : "-translate-y-2"
          }`}
        >
          <DynamicIslandHub {...props.hubProps} />
        </div>
      </div>
    </div>
  );
}

export function DynamicIsland(props: DynamicIslandProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<HubViewMode>("search");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { session, elapsedSeconds } = useDynamicIslandElapsed(props.activeSession, props.offlineSession);
  const pendingConfirmations = props.pendingConfirmationsCount ?? props.confirmationsCount ?? 0;

  useDynamicIslandKeyboard(isOpen, setIsOpen, setViewMode, setQuery, inputRef, containerRef);

  const pool = useMemo(
    () => computeDynamicIslandStatePool({
      activeSession: props.activeSession, offlineSession: props.offlineSession,
      syncState: props.syncState, recovery: props.recovery, eveningReview: props.eveningReview,
      quickReviewClaim: props.quickReviewClaim, confirmationsCount: pendingConfirmations,
      pendingConfirmationsCount: pendingConfirmations, elapsedSeconds,
      onRetrySync: props.onRetrySync, onResumeSession: props.onResumeSession,
    }),
    [props.activeSession, props.offlineSession, props.syncState, props.recovery, props.eveningReview,
     props.quickReviewClaim, pendingConfirmations, elapsedSeconds, props.onRetrySync, props.onResumeSession]
  );

  const ticker = useDynamicIslandTicker({
    activeStates: pool.activeStates, fallbackItem: pool.dominantState, isExternallyPaused: isOpen,
  });

  const commands = useMemo(() => filterGlobalCommands(query, props.commands ?? GLOBAL_COMMANDS), [props.commands, query]);
  const selectedIndex = clampCommandIndex(activeIndex, commands.length);
  const { executeCommand, handleInputKeyDown } = useDynamicIslandHandlers(
    query, setQuery, commands, selectedIndex, setActiveIndex, setIsOpen, setViewMode, inputRef, props.onOpenAction
  );
  const { isResuming, handleDirectResume } = useDirectResumeSession(
    props.userId, ticker.currentItem, session, props.onResumeSession
  );

  const containerGlowClass = getCapsuleGlowStyle(ticker.currentItem.kind, isOpen);

  return (
    <div ref={containerRef} {...ticker.containerProps} className="relative mx-auto flex h-9 w-full min-w-0 max-w-[32rem] items-center justify-center z-[var(--af-layer-modal)]">
      <div
        className={`absolute top-0 left-0 right-0 overflow-hidden border bg-[#090e12]/98 shadow-2xl backdrop-blur-2xl transition-[border-radius,box-shadow,border-color,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen ? "rounded-[20px] border-teal-500/40 shadow-[0_0_32px_rgba(45,212,191,0.18)] ring-1 ring-white/10" : `rounded-[18px] cursor-pointer ${containerGlowClass}`
        }`}
        onClick={!isOpen ? () => { setIsOpen(true); setViewMode("search"); inputRef.current?.focus(); } : undefined}
      >
        <DynamicIslandCollapsedBar
          currentItem={ticker.currentItem}
          tickerTotalStates={ticker.totalStates}
          tickerCurrentIndex={ticker.currentIndex}
          query={query}
          onQueryChange={(q) => { setQuery(q); setActiveIndex(0); if (!isOpen) setIsOpen(true); setViewMode("search"); }}
          onOpenSearch={() => { setIsOpen(true); setViewMode("search"); inputRef.current?.focus(); }}
          onKeyDown={handleInputKeyDown}
          onClearQuery={() => { setQuery(""); inputRef.current?.focus(); }}
          inputRef={inputRef}
          isOpen={isOpen}
          isResuming={isResuming}
          elapsedSeconds={elapsedSeconds}
          onOpenOverview={(e) => { e?.stopPropagation(); setIsOpen(true); setViewMode(resolveOverviewMode(ticker.currentItem.kind)); }}
          onOpenFocus={(e) => { e?.stopPropagation(); setIsOpen(true); setViewMode("focus"); }}
          onDirectResume={handleDirectResume}
          onRetrySync={props.onRetrySync}
          onCloseDrawer={() => setIsOpen(false)}
        />
        <DynamicIslandExpandedFold
          isOpen={isOpen}
          hubProps={{
            isOpen, viewMode, onViewModeChange: setViewMode, onClose: () => setIsOpen(false),
            activeStates: pool.activeStates, dominantState: pool.dominantState, elapsedSeconds,
            isResuming, searchQuery: query, onSearchChange: setQuery,
            commands, selectedIndex, onSelectIndex: setActiveIndex, onExecuteCommand: executeCommand,
            onDirectResume: handleDirectResume, onRetrySync: props.onRetrySync,
            onOpenRecovery: props.recovery?.onOpen ?? (() => props.onOpenAction("recovery-help")),
            onOpenAction: props.onOpenAction, eveningReview: props.eveningReview, pendingConfirmationsCount: pendingConfirmations,
          }}
        />
      </div>
    </div>
  );
}
