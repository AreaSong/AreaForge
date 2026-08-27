"use client";

import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type RefObject,
} from "react";
import {
  clampCommandIndex,
  GLOBAL_COMMANDS,
  filterGlobalCommands,
  type GlobalCommandAction,
  type GlobalCommandDefinition,
} from "@/lib/navigation/command-palette";
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
import {
  useLiquidMorphState,
  getCapsuleLiquidMorphClass,
  getSatelliteLiquidClass,
  getLiquidFoldAnimationClass,
  isReducedMotionPreferred,
  LIQUID_TIMINGS,
  type LiquidMorphPhase,
  type UseLiquidMorphOptions,
  type UseLiquidMorphResult,
} from "./dynamic-island-morph";
import {
  subscribeNow,
  getNowSnapshot,
  getServerNowSnapshot,
  useDynamicIslandElapsed,
  resolveOverviewMode,
  useDynamicIslandHandlers,
  useDirectResumeSession,
  useDirectPauseSession,
  DynamicIslandCollapsedBar,
  DynamicIslandExpandedFold,
} from "./dynamic-island-helpers";
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
  useLiquidMorphState, getCapsuleLiquidMorphClass, getSatelliteLiquidClass, getLiquidFoldAnimationClass,
  isReducedMotionPreferred, LIQUID_TIMINGS,
  subscribeNow, getNowSnapshot, getServerNowSnapshot, useDynamicIslandElapsed,
  resolveOverviewMode, useDynamicIslandHandlers, useDirectResumeSession, useDirectPauseSession,
  DynamicIslandCollapsedBar, DynamicIslandExpandedFold,
};

export type {
  HubViewMode, DynamicIslandHubProps, CapsuleBreathingDotsProps, CapsuleLeftSegmentProps,
  CapsuleCenterSegmentProps, CapsuleRightSegmentProps, SatelliteBubbleProps, ToneColorSpec, BreathingPaginationDot,
  DynamicIslandPaginationDot, UseDynamicIslandTickerOptions, UseDynamicIslandTickerResult,
  DynamicIslandCapsuleKind, DynamicIslandStateKind, DynamicIslandSyncState, DynamicIslandTone, DynamicIslandRecoveryProps,
  DynamicIslandEveningReviewProps, DynamicIslandQuickAction, DynamicIslandActiveItem,
  DynamicIslandStatePool, DualTaskResolutionResult, CollectDynamicIslandStatesInput, DynamicIslandStateEngineInput,
  DynamicIslandCapsuleState, LiquidMorphPhase, UseLiquidMorphOptions, UseLiquidMorphResult,
};

export const DYNAMIC_ISLAND_SEARCH_PLACEHOLDER = "搜索或输入命令… ⌘K";

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

export function isInputElement(el: Element | null): boolean {
  if (!el) return false;
  const tagName = el.tagName?.toUpperCase();
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  return Boolean((el as HTMLElement).isContentEditable);
}

function useDynamicIslandKeyboard(
  isOpen: boolean,
  setIsOpen: (open: boolean) => void,
  fastForwardToExpanded: () => void,
  requestClose: () => void,
  setViewMode: (mode: HubViewMode) => void,
  setQuery: (query: string) => void,
  inputRef: RefObject<HTMLInputElement | null>,
  containerRef: RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = isInputElement(activeEl);

      // 1. ⌘K or Ctrl+K (global penetration)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen(true);
        fastForwardToExpanded();
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
        fastForwardToExpanded();
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
        requestClose();
        inputRef.current?.blur();
        setQuery("");
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, setIsOpen, fastForwardToExpanded, requestClose, setViewMode, setQuery, inputRef]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        requestClose();
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, setIsOpen, requestClose, setQuery, containerRef]);
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

  const hasSatellite = Boolean(dualTask.satellite);

  const morph = useLiquidMorphState({
    hasSatellite,
    isOpen,
    onOpenChange: setIsOpen,
  });

  useDynamicIslandKeyboard(
    isOpen,
    setIsOpen,
    morph.fastForwardToExpanded,
    morph.requestClose,
    setViewMode,
    setQuery,
    inputRef,
    containerRef
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

  // Wheel swipe gesture for fluid swap
  const wheelLockRef = useRef(false);
  const handleWheel = (e: React.WheelEvent) => {
    if (wheelLockRef.current || !dualTask.satellite || isOpen) return;
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
    isExternallyPaused: isOpen || morph.isMerging,
  });

  const currentItem =
    dualTask.satellite || swappedPrimaryKind ? dualTask.dominant || ticker.currentItem : ticker.currentItem;

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

  const handleCapsuleClick = () => {
    if (!isOpen && !morph.isMerging) {
      morph.requestOpen();
      const targetTab = getDefaultTabForStateKind(currentItem.kind);
      setViewMode(targetTab);
      if (targetTab === "search") {
        setTimeout(() => inputRef.current?.focus(), 10);
      }
    }
  };

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
          morph.capsuleMorphClass
        } ${
          isOpen && morph.isExpanded
            ? "rounded-[20px] border-teal-500/40 shadow-[0_0_32px_rgba(45,212,191,0.18)] " + expandedAuraClass
            : `rounded-[18px] ${containerGlowClass}`
        }`}
        onClick={handleCapsuleClick}
      >
        <DynamicIslandCollapsedBar
          currentItem={currentItem}
          tickerTotalStates={ticker.totalStates}
          tickerCurrentIndex={ticker.currentIndex}
          query={query}
          onQueryChange={(q) => {
            setQuery(q);
            setActiveIndex(0);
            if (!isOpen) morph.fastForwardToExpanded();
            setViewMode("search");
          }}
          onOpenSearch={() => {
            morph.fastForwardToExpanded();
            setViewMode("search");
            inputRef.current?.focus();
          }}
          onKeyDown={handleInputKeyDown}
          onClearQuery={() => { setQuery(""); inputRef.current?.focus(); }}
          inputRef={inputRef}
          isOpen={isOpen}
          isResuming={isResuming}
          isPausing={isPausing}
          elapsedSeconds={elapsedSeconds}
          onOpenOverview={(e) => {
            e?.stopPropagation();
            morph.requestOpen();
            setViewMode(resolveOverviewMode(currentItem.kind));
          }}
          onOpenFocus={(e) => {
            e?.stopPropagation();
            morph.requestOpen();
            setViewMode("focus");
          }}
          onDirectResume={handleDirectResume}
          onDirectPause={handleDirectPause}
          onRetrySync={props.onRetrySync}
          onCloseDrawer={morph.requestClose}
        />
        <DynamicIslandExpandedFold
          isOpen={isOpen}
          phase={morph.phase}
          hubProps={{
            isOpen,
            viewMode,
            onViewModeChange: setViewMode,
            onClose: morph.requestClose,
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
      {morph.isRenderedSatellite && dualTask.satellite ? (
        <SatelliteBubble
          satelliteItem={dualTask.satellite}
          animationClass={morph.satelliteAnimationClass}
          onSwapFluidFocus={handleSwapFluidFocus}
          onSwap={() => handleSwapFluidFocus(dualTask.satellite?.kind)}
        />
      ) : null}
    </div>
  );
}
