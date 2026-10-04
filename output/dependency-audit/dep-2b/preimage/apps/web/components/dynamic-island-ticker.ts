"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  type DynamicIslandActiveItem,
  type DynamicIslandCapsuleKind,
  type DynamicIslandTone,
  type DynamicIslandStatePool,
  IDLE_STATE_ITEM,
} from "./dynamic-island-types";

export const TICKER_INTERVAL_MS = 6000;
export const DEFAULT_TICKER_INTERVAL_MS = TICKER_INTERVAL_MS;

export const TICKER_RESUME_GRACE_MS = 2000;
export const DEFAULT_RESUME_GRACE_MS = TICKER_RESUME_GRACE_MS;

export interface BreathingPaginationDot {
  index: number;
  isActive: boolean;
  label: string;
}

export interface DynamicIslandPaginationDot extends BreathingPaginationDot {
  kind?: DynamicIslandCapsuleKind;
  tone?: DynamicIslandTone;
}

export interface UseDynamicIslandTickerOptions {
  activeStates: readonly DynamicIslandActiveItem[];
  fallbackItem?: DynamicIslandActiveItem;
  intervalMs?: number;
  resumeGraceMs?: number;
  isExternallyPaused?: boolean;
  isPaused?: boolean;
  onStateChange?: (item: DynamicIslandActiveItem, index: number) => void;
}

export interface UseDynamicIslandTickerResult {
  currentItem: DynamicIslandActiveItem;
  currentState: DynamicIslandActiveItem;
  currentIndex: number;
  totalStates: number;
  hasMultipleStates: boolean;
  isP0Pinned: boolean;
  isPaused: boolean;
  isHovered: boolean;
  isInputFocused: boolean;
  paginationDots: DynamicIslandPaginationDot[];
  dotsText: string;
  containerProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  };
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  pause: () => void;
  resume: () => void;
}

/**
 * Checks if activeStates contains a P0 live session (pinned focus).
 */
export function isTickerP0Pinned(
  activeStatesOrPool:
    | readonly DynamicIslandActiveItem[]
    | DynamicIslandStatePool
    | { activeStates?: readonly DynamicIslandActiveItem[]; dominantState?: DynamicIslandActiveItem }
): boolean {
  if (!activeStatesOrPool) return false;
  if (Array.isArray(activeStatesOrPool)) {
    return activeStatesOrPool.length > 0 && activeStatesOrPool[0]?.kind === "live_session_running";
  }
  const obj = activeStatesOrPool as { activeStates?: readonly DynamicIslandActiveItem[]; dominantState?: DynamicIslandActiveItem };
  if (obj.dominantState) {
    return obj.dominantState.kind === "live_session_running";
  }
  if (Array.isArray(obj.activeStates)) {
    return obj.activeStates.length > 0 && obj.activeStates[0]?.kind === "live_session_running";
  }
  return false;
}

/**
 * Evaluates whether multi-state ticker auto-rotation should be enabled.
 */
export function isTickerRotationEnabled(
  poolOrStates:
    | DynamicIslandStatePool
    | { activeStates: readonly DynamicIslandActiveItem[]; dominantState?: DynamicIslandActiveItem }
    | readonly DynamicIslandActiveItem[]
): boolean {
  if (!poolOrStates) return false;
  let activeStates: readonly DynamicIslandActiveItem[] = [];
  let dominantKind: DynamicIslandCapsuleKind | undefined;

  if (Array.isArray(poolOrStates)) {
    activeStates = poolOrStates;
    dominantKind = activeStates[0]?.kind;
  } else {
    const obj = poolOrStates as { activeStates?: readonly DynamicIslandActiveItem[]; dominantState?: DynamicIslandActiveItem };
    activeStates = obj.activeStates ?? [];
    dominantKind = obj.dominantState?.kind ?? activeStates[0]?.kind;
  }

  if (activeStates.length <= 1) return false;
  if (dominantKind === "live_session_running" || activeStates[0]?.kind === "live_session_running") {
    return false;
  }
  return true;
}

/**
 * Clamps an index within [0, totalStates - 1], returning 0 if totalStates <= 0.
 */
export function clampTickerIndex(index: number, totalStates: number): number {
  if (typeof totalStates !== "number" || totalStates <= 0) return 0;
  if (typeof index !== "number" || !Number.isFinite(index) || Number.isNaN(index)) return 0;
  const floored = Math.floor(index);
  return Math.max(0, Math.min(floored, totalStates - 1));
}

/**
 * Calculates next ticker index with circular wrap-around.
 */
export function getNextTickerIndex(currentIndex: number, totalStates: number): number {
  if (typeof totalStates !== "number" || totalStates <= 1) return 0;
  const clamped = clampTickerIndex(currentIndex, totalStates);
  return (clamped + 1) % totalStates;
}
export const computeNextTickerIndex = getNextTickerIndex;

/**
 * Calculates previous ticker index with circular wrap-around.
 */
export function getPrevTickerIndex(currentIndex: number, totalStates: number): number {
  if (typeof totalStates !== "number" || totalStates <= 1) return 0;
  const clamped = clampTickerIndex(currentIndex, totalStates);
  return (clamped - 1 + totalStates) % totalStates;
}
export const computePrevTickerIndex = getPrevTickerIndex;

/**
 * Computes next ticker index for a state machine step.
 */
export function computeTickerNextState(options: {
  currentIndex: number;
  totalStates: number;
  isPaused?: boolean;
  hasP0Pinned?: boolean;
}): number {
  const { currentIndex, totalStates, isPaused = false, hasP0Pinned = false } = options;
  if (hasP0Pinned || totalStates <= 1) return 0;
  if (isPaused) return clampTickerIndex(currentIndex, totalStates);
  return getNextTickerIndex(currentIndex, totalStates);
}

/**
 * Resolves current active item safely without out-of-bounds access.
 */
export function resolveTickerCurrentItem(
  activeStates: readonly DynamicIslandActiveItem[],
  currentIndex: number,
  fallbackItem: DynamicIslandActiveItem = IDLE_STATE_ITEM
): DynamicIslandActiveItem {
  if (!activeStates || activeStates.length === 0) return fallbackItem;
  const safeIndex = clampTickerIndex(currentIndex, activeStates.length);
  return activeStates[safeIndex] ?? fallbackItem;
}

/**
 * Pure generator for breathing pagination dot descriptors given activeIndex and total count.
 */
export function computeBreathingPagination(
  activeIndex: number,
  totalStates: number
): BreathingPaginationDot[] {
  if (typeof totalStates !== "number" || totalStates <= 1) return [];
  const safeActive = clampTickerIndex(activeIndex, totalStates);
  return Array.from({ length: totalStates }, (_, idx) => ({
    index: idx,
    isActive: idx === safeActive,
    label:
      idx === safeActive
        ? `第 ${idx + 1} 项 (当前激活，共 ${totalStates} 项)`
        : `第 ${idx + 1} 项 (共 ${totalStates} 项)`,
  }));
}
export const generatePaginationDots = (totalStates: number, activeIndex: number) =>
  computeBreathingPagination(activeIndex, totalStates);

/**
 * Computes full pagination dot descriptors for multi-state alerts.
 */
export function computePaginationDots(
  activeStates: readonly DynamicIslandActiveItem[],
  activeIndex: number
): DynamicIslandPaginationDot[] {
  if (!activeStates || activeStates.length <= 1) return [];
  const safeActive = clampTickerIndex(activeIndex, activeStates.length);
  return activeStates.map((item, idx) => ({
    index: idx,
    isActive: idx === safeActive,
    kind: item.kind,
    tone: item.accentTone,
    label:
      idx === safeActive
        ? `第 ${idx + 1} 项 (当前激活: ${item.title}，共 ${activeStates.length} 项)`
        : `第 ${idx + 1} 项 (${item.title}，共 ${activeStates.length} 项)`,
  }));
}

/**
 * Formats breathing pagination dots string (e.g. "● ○ ○").
 */
export function formatDotsText(total: number, activeIndex: number): string {
  if (typeof total !== "number" || total <= 1) return "";
  const safeActive = clampTickerIndex(activeIndex, total);
  return Array.from({ length: total }, (_, i) => (i === safeActive ? "●" : "○")).join(" ");
}

/**
 * Custom React hook for Smart Ticker auto-rotation, hover/focus pause, and 2s resume grace period.
 */
export function useDynamicIslandTicker(
  options: UseDynamicIslandTickerOptions
): UseDynamicIslandTickerResult {
  const {
    activeStates,
    fallbackItem = IDLE_STATE_ITEM,
    intervalMs = DEFAULT_TICKER_INTERVAL_MS,
    resumeGraceMs = DEFAULT_RESUME_GRACE_MS,
    isExternallyPaused = false,
    isPaused: isPausedProp = false,
    onStateChange,
  } = options;

  const [rawIndex, setRawIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isManualPaused, setIsManualPaused] = useState(false);

  const totalStates = activeStates ? activeStates.length : 0;
  const isP0Pinned = isTickerP0Pinned(activeStates);
  const hasMultipleStates = totalStates > 1;

  // Derive safe index during render (no setState in useEffect required)
  const safeIndex = isP0Pinned ? 0 : clampTickerIndex(rawIndex, totalStates);

  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isPaused =
    isHovered ||
    isInputFocused ||
    isExternallyPaused ||
    isPausedProp ||
    isManualPaused ||
    isP0Pinned ||
    totalStates <= 1;

  useEffect(() => {
    if (isPaused || typeof window === "undefined") return;

    const timer = window.setInterval(() => {
      setRawIndex((prev) => {
        const nextIndex = getNextTickerIndex(prev, totalStates);
        if (onStateChange && activeStates[nextIndex]) {
          onStateChange(activeStates[nextIndex], nextIndex);
        }
        return nextIndex;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isPaused, totalStates, intervalMs, activeStates, onStateChange]);

  useEffect(() => {
    return () => {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    graceTimerRef.current = setTimeout(() => {
      setIsHovered(false);
      graceTimerRef.current = null;
    }, resumeGraceMs);
  }, [resumeGraceMs]);

  const handleFocus = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    setIsInputFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    graceTimerRef.current = setTimeout(() => {
      setIsInputFocused(false);
      graceTimerRef.current = null;
    }, resumeGraceMs);
  }, [resumeGraceMs]);

  const next = useCallback(() => {
    if (totalStates <= 1) return;
    setRawIndex((prev) => getNextTickerIndex(prev, totalStates));
  }, [totalStates]);

  const prev = useCallback(() => {
    if (totalStates <= 1) return;
    setRawIndex((prev) => getPrevTickerIndex(prev, totalStates));
  }, [totalStates]);

  const goTo = useCallback(
    (index: number) => {
      if (totalStates <= 0) return;
      setRawIndex(clampTickerIndex(index, totalStates));
    },
    [totalStates]
  );

  const pause = useCallback(() => setIsManualPaused(true), []);
  const resume = useCallback(() => setIsManualPaused(false), []);

  const currentItem = useMemo(
    () => resolveTickerCurrentItem(activeStates, safeIndex, fallbackItem),
    [activeStates, safeIndex, fallbackItem]
  );

  const paginationDots = useMemo(
    () => computePaginationDots(activeStates, safeIndex),
    [activeStates, safeIndex]
  );

  const dotsText = useMemo(
    () => formatDotsText(totalStates, safeIndex),
    [totalStates, safeIndex]
  );

  const containerProps = useMemo(
    () => ({
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      onFocus: handleFocus,
      onBlur: handleBlur,
    }),
    [handleMouseEnter, handleMouseLeave, handleFocus, handleBlur]
  );

  return {
    currentItem,
    currentState: currentItem,
    currentIndex: safeIndex,
    totalStates,
    hasMultipleStates,
    isP0Pinned,
    isPaused,
    isHovered,
    isInputFocused,
    paginationDots,
    dotsText,
    containerProps,
    next,
    prev,
    goTo,
    pause,
    resume,
  };
}
