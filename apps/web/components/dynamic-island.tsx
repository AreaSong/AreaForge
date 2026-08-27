"use client";

import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
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
  MorphingFloatingHub,
  HubSupervisionOverview,
  HubFlowStopwatchPanel,
  HubConfirmationClosureGuide,
  HubCommandPaletteList,
  HubViewModeTabs,
  normalizeHubTab,
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
  getExpandedHubAuraClass,
  getAuraStyles,
  getAuraThemeForStateKind,
  getDefaultTabForStateKind,
  getSatelliteBubbleGlowClass,
  TONE_COLOR_SPECS,
  type ToneColorSpec,
} from "./dynamic-island-glow";
import {
  CapsuleBreathingDots,
  CapsuleLeftSegment,
  CapsuleCenterSegment,
  CapsuleRightSegment,
  SatelliteBubble,
  type CapsuleBreathingDotsProps,
  type CapsuleLeftSegmentProps,
  type CapsuleCenterSegmentProps,
  type CapsuleRightSegmentProps,
  type SatelliteBubbleProps,
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
  type DynamicIslandStateKind,
  type DynamicIslandSyncState,
  type DynamicIslandTone,
  type DynamicIslandRecoveryProps,
  type DynamicIslandEveningReviewProps,
  type DynamicIslandQuickAction,
  type DynamicIslandActiveItem,
  type DynamicIslandStatePool,
  type DualTaskResolutionResult,
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
  resolveDualTaskStates,
  computeDynamicIslandStatePool,
  collectDynamicIslandStatePool,
  validateStatePoolInvariants,
  resolveDynamicIslandState,
} from "./dynamic-island-state-engine";

export {
  DynamicIslandHub, MorphingFloatingHub, HubSupervisionOverview, HubFlowStopwatchPanel, HubConfirmationClosureGuide,
  HubCommandPaletteList, HubViewModeTabs, DynamicIslandHeroDrawer, DynamicIslandCommandList,
  CapsuleBreathingDots, CapsuleLeftSegment, CapsuleCenterSegment, CapsuleRightSegment, SatelliteBubble,
  getCapsuleGlowStyle, getCapsuleGlowClass, getCapsuleInlineStyle, getToneFromCapsuleKind,
  getCapsuleToneColors, getExpandedHubAuraClass, getAuraStyles, getAuraThemeForStateKind, getDefaultTabForStateKind,
  getSatelliteBubbleGlowClass, TONE_COLOR_SPECS, normalizeHubTab,
  useDynamicIslandTicker, getNextTickerIndex, getPrevTickerIndex, clampTickerIndex, computeBreathingPagination,
  isTickerP0Pinned, isTickerRotationEnabled, computeTickerNextState, computePaginationDots, generatePaginationDots,
  formatDotsText, resolveTickerCurrentItem, TICKER_INTERVAL_MS, DEFAULT_TICKER_INTERVAL_MS,
  TICKER_RESUME_GRACE_MS, DEFAULT_RESUME_GRACE_MS, clampTimerDuration, getPriorityWeight,
  createIdleStateItem, collectDynamicIslandActiveStates, sortActiveStatesByPriority,
  getDominantState, resolveDominantState, resolveDualTaskStates, computeDynamicIslandStatePool, collectDynamicIslandStatePool,
  validateStatePoolInvariants, resolveDynamicIslandState, PRIORITY_WEIGHTS, IDLE_STATE_ITEM,
};

export type {
  HubViewMode, DynamicIslandHubProps, CapsuleBreathingDotsProps, CapsuleLeftSegmentProps,
  CapsuleCenterSegmentProps, CapsuleRightSegmentProps, SatelliteBubbleProps, ToneColorSpec, BreathingPaginationDot,
  DynamicIslandPaginationDot, UseDynamicIslandTickerOptions, UseDynamicIslandTickerResult,
  DynamicIslandCapsuleKind, DynamicIslandStateKind, DynamicIslandSyncState, DynamicIslandTone, DynamicIslandRecoveryProps,
  DynamicIslandEveningReviewProps, DynamicIslandQuickAction, DynamicIslandActiveItem,
  DynamicIslandStatePool, DualTaskResolutionResult, CollectDynamicIslandStatesInput, DynamicIslandStateEngineInput,
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
  pathname?: string | null;
}

function isInputElement(el: Element | null): boolean {
  if (!el) return false;
  const tagName = el.tagName?.toUpperCase();
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  if ((el as HTMLElement).isContentEditable) {
    return true;
  }
  return false;
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
      const activeEl = document.activeElement;
      const isInput = isInputElement(activeEl);

      // 1. ⌘K or Ctrl+K (global penetration)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen(true);
        setViewMode("search");
        setTimeout(() => {
          inputRef.current?.focus();
        }, 10);
        return;
      }

      // 2. / (forward slash) when not inside input/textarea/select/editable
      if (e.key === "/" && !isInput && !isOpen) {
        e.preventDefault();
        setIsOpen(true);
        setViewMode("search");
        setTimeout(() => {
          inputRef.current?.focus();
        }, 10);
        return;
      }

      // 3. Escape key collapses the dynamic island
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        setIsOpen(false);
        inputRef.current?.blur();
        setQuery("");
        return;
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

function useDirectPauseSession(
  userId: string,
  currentItem: DynamicIslandActiveItem,
  session: StudySessionDto | null
) {
  const [isPausing, setIsPausing] = useState(false);

  async function handleDirectPause(e?: React.MouseEvent) {
    e?.stopPropagation();
    const pauseSession = currentItem.session || session;
    if (!pauseSession?.id || isPausing) return;
    setIsPausing(true);
    try {
      const res = await postStudySessionCommand(pauseSession.id, "pause", {}, getClientDeviceHeaders());
      if (res.ok && res.body?.session) publishActivityStatus(userId, res.body.session);
    } finally {
      setIsPausing(false);
    }
  }

  return { isPausing, handleDirectPause };
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
  isPausing?: boolean;
  elapsedSeconds: number;
  onOpenOverview: (e?: React.MouseEvent) => void;
  onOpenFocus: (e?: React.MouseEvent) => void;
  onDirectResume: (e?: React.MouseEvent) => Promise<void>;
  onDirectPause?: (e?: React.MouseEvent) => Promise<void>;
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
        isPausing={props.isPausing}
        elapsedSeconds={props.elapsedSeconds}
        onTriggerOpen={props.onOpenOverview}
        onOpenFocus={props.onOpenFocus}
        onDirectResume={props.onDirectResume}
        onDirectPause={props.onDirectPause}
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
          <MorphingFloatingHub {...props.hubProps} />
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
  const [swappedPrimaryKind, setSwappedPrimaryKind] = useState<
    DynamicIslandCapsuleKind | DynamicIslandStateKind | null
  >(null);

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
      pathname: props.pathname,
    }),
    [props.activeSession, props.offlineSession, props.syncState, props.recovery, props.eveningReview,
     props.quickReviewClaim, pendingConfirmations, elapsedSeconds, props.onRetrySync, props.onResumeSession, props.pathname]
  );

  const dualTask = useMemo(
    () => resolveDualTaskStates(pool.activeStates, props.pathname, swappedPrimaryKind),
    [pool.activeStates, props.pathname, swappedPrimaryKind]
  );

  const handleSwapFluidFocus = useCallback(
    (targetKind?: DynamicIslandCapsuleKind | DynamicIslandStateKind) => {
      if (!dualTask.satellite) return;
      const nextDominantKind = targetKind || dualTask.satellite.kind;
      setSwappedPrimaryKind((prev) =>
        prev === nextDominantKind ? dualTask.dominant.kind : nextDominantKind
      );
    },
    [dualTask.satellite, dualTask.dominant]
  );

  const hasSatellite = Boolean(dualTask.satellite) && !isOpen;

  // Wheel swipe gesture for fluid swap
  const wheelLockRef = useRef(false);
  const handleWheel = (e: React.WheelEvent) => {
    if (wheelLockRef.current || !hasSatellite || !dualTask.satellite) return;
    if (Math.abs(e.deltaY) > 20 || Math.abs(e.deltaX) > 20) {
      wheelLockRef.current = true;
      handleSwapFluidFocus(dualTask.satellite.kind);
      setTimeout(() => {
        wheelLockRef.current = false;
      }, 350);
    }
  };

  const ticker = useDynamicIslandTicker({
    activeStates: pool.activeStates,
    fallbackItem: dualTask.dominant || pool.dominantState,
    isExternallyPaused: isOpen,
  });

  const currentItem =
    hasSatellite || swappedPrimaryKind ? dualTask.dominant || ticker.currentItem : ticker.currentItem;

  const commands = useMemo(() => filterGlobalCommands(query, props.commands ?? GLOBAL_COMMANDS), [props.commands, query]);
  const selectedIndex = clampCommandIndex(activeIndex, commands.length);
  const { executeCommand, handleInputKeyDown } = useDynamicIslandHandlers(
    query, setQuery, commands, selectedIndex, setActiveIndex, setIsOpen, setViewMode, inputRef, props.onOpenAction
  );
  const { isResuming, handleDirectResume } = useDirectResumeSession(
    props.userId, currentItem, session, props.onResumeSession
  );
  const { isPausing, handleDirectPause } = useDirectPauseSession(
    props.userId, currentItem, session
  );

  const containerGlowClass = getCapsuleGlowStyle(currentItem.kind, isOpen);
  const expandedAuraClass = getExpandedHubAuraClass(currentItem.kind);

  return (
    <div
      ref={containerRef}
      {...ticker.containerProps}
      onWheel={handleWheel}
      className="relative mx-auto flex h-9 w-full min-w-0 max-w-[32rem] items-center justify-center gap-2 z-[var(--af-layer-modal)]"
    >
      {/* Main Capsule */}
      <div
        className={`overflow-hidden border bg-[#090e12]/98 shadow-2xl backdrop-blur-2xl transition-[border-radius,box-shadow,border-color,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen
            ? "rounded-[20px] border-teal-500/40 shadow-[0_0_32px_rgba(45,212,191,0.18)] absolute top-0 left-0 right-0 ring-1 ring-white/10 w-full z-20 " + expandedAuraClass
            : `rounded-[18px] relative h-9 flex-1 cursor-pointer ${containerGlowClass}`
        }`}
        onClick={
          !isOpen
            ? () => {
                setIsOpen(true);
                const targetTab = getDefaultTabForStateKind(currentItem.kind);
                setViewMode(targetTab);
                if (targetTab === "search") {
                  setTimeout(() => inputRef.current?.focus(), 10);
                }
              }
            : undefined
        }
      >
        <DynamicIslandCollapsedBar
          currentItem={currentItem}
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
          isPausing={isPausing}
          elapsedSeconds={elapsedSeconds}
          onOpenOverview={(e) => { e?.stopPropagation(); setIsOpen(true); setViewMode(resolveOverviewMode(currentItem.kind)); }}
          onOpenFocus={(e) => { e?.stopPropagation(); setIsOpen(true); setViewMode("focus"); }}
          onDirectResume={handleDirectResume}
          onDirectPause={handleDirectPause}
          onRetrySync={props.onRetrySync}
          onCloseDrawer={() => setIsOpen(false)}
        />
        <DynamicIslandExpandedFold
          isOpen={isOpen}
          hubProps={{
            isOpen,
            viewMode,
            onViewModeChange: setViewMode,
            onClose: () => setIsOpen(false),
            activeStates: pool.activeStates,
            dominantState: currentItem,
            elapsedSeconds,
            isResuming,
            searchQuery: query,
            onSearchChange: setQuery,
            commands,
            selectedIndex,
            onSelectIndex: setActiveIndex,
            onExecuteCommand: executeCommand,
            onDirectResume: handleDirectResume,
            onRetrySync: props.onRetrySync,
            onOpenRecovery: props.recovery?.onOpen ?? (() => props.onOpenAction("recovery-help")),
            onOpenAction: props.onOpenAction,
            eveningReview: props.eveningReview,
            pendingConfirmationsCount: pendingConfirmations,
            pathname: props.pathname,
            defaultTab: getDefaultTabForStateKind(currentItem.kind),
            auraTheme: getAuraThemeForStateKind(currentItem.kind),
          }}
        />
      </div>

      {/* Satellite Bubble (Exclamation Mark ! Layout) */}
      {hasSatellite && dualTask.satellite ? (
        <SatelliteBubble
          satelliteItem={dualTask.satellite}
          onSwapFluidFocus={handleSwapFluidFocus}
          onSwap={() => handleSwapFluidFocus(dualTask.satellite?.kind)}
        />
      ) : null}
    </div>
  );
}
