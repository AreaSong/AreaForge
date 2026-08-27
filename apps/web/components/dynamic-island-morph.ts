"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export type LiquidMorphPhase =
  | "idle_split"
  | "idle_single"
  | "merging_p1"
  | "expanded_p2"
  | "collapsing_p1"
  | "detaching_p2";

export const LIQUID_TIMINGS = {
  MERGE_P1_MS: 400,
  EXPAND_P2_MS: 320,
  COLLAPSE_P1_MS: 260,
  DETACH_P2_MS: 360,
} as const;

export interface UseLiquidMorphOptions {
  hasSatellite: boolean;
  isOpen: boolean;
  onOpenChange?: (open: boolean) => void;
}

export interface UseLiquidMorphResult {
  phase: LiquidMorphPhase;
  isExpanded: boolean;
  isMerging: boolean;
  isCollapsing: boolean;
  isDetaching: boolean;
  isRenderedSatellite: boolean;
  satelliteAnimationClass: string;
  capsuleMorphClass: string;
  requestOpen: () => void;
  requestClose: () => void;
  fastForwardToExpanded: () => void;
}

export function isReducedMotionPreferred(): boolean {
  if (typeof window === "undefined") return false;
  const mediaQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const hasAttribute = document.documentElement.getAttribute("data-af-motion") === "reduce";
  return Boolean(mediaQuery?.matches || hasAttribute);
}

export function getSatelliteLiquidClass(phase: LiquidMorphPhase, hasSatellite: boolean): string {
  if (!hasSatellite) return "hidden opacity-0 pointer-events-none";
  switch (phase) {
    case "idle_split":
      return "opacity-100 transform-none";
    case "merging_p1":
      return "af-satellite-fusing pointer-events-none";
    case "expanded_p2":
    case "collapsing_p1":
      return "opacity-0 pointer-events-none scale-50 -translate-x-4";
    case "detaching_p2":
      return "af-satellite-detaching";
    case "idle_single":
    default:
      return "hidden opacity-0 pointer-events-none";
  }
}

export function getCapsuleLiquidMorphClass(
  phase: LiquidMorphPhase,
  hasSatellite: boolean,
  isOpen: boolean
): string {
  const baseTransitions =
    "transition-[width,max-width,flex-grow,border-radius,box-shadow,border-color,background-color] cubic-bezier(0.16,1,0.3,1)";

  switch (phase) {
    case "idle_split":
      return `rounded-[18px] relative h-9 flex-1 cursor-pointer ${baseTransitions} duration-200`;
    case "idle_single":
      return `rounded-[18px] relative h-9 w-full flex-1 cursor-pointer ${baseTransitions} duration-200`;
    case "merging_p1":
      return `rounded-[18px] relative h-9 w-full flex-1 cursor-pointer ${baseTransitions} duration-[400ms] af-capsule-merged`;
    case "expanded_p2":
      return `rounded-[20px] absolute top-0 left-0 right-0 w-full z-20 ${baseTransitions} duration-[320ms] ring-1 ring-white/10`;
    case "collapsing_p1":
      return `rounded-[18px] absolute top-0 left-0 right-0 w-full z-20 ${baseTransitions} duration-[260ms] ring-1 ring-white/10`;
    case "detaching_p2":
      return `rounded-[18px] relative h-9 flex-1 cursor-pointer ${baseTransitions} duration-[360ms]`;
    default:
      return isOpen
        ? "rounded-[20px] absolute top-0 left-0 right-0 w-full z-20"
        : hasSatellite
          ? "rounded-[18px] relative h-9 flex-1 cursor-pointer"
          : "rounded-[18px] relative h-9 w-full flex-1 cursor-pointer";
  }
}

export function getLiquidFoldAnimationClass(phase: LiquidMorphPhase): {
  containerGridClass: string;
  innerContentClass: string;
} {
  const isFoldOpen = phase === "expanded_p2";
  return {
    containerGridClass: `grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
      isFoldOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
    }`,
    innerContentClass: `px-3 pb-3 pt-2 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
      isFoldOpen ? "translate-y-0" : "-translate-y-2"
    }`,
  };
}

export function useLiquidMorphState(options: UseLiquidMorphOptions): UseLiquidMorphResult {
  const { hasSatellite, isOpen, onOpenChange } = options;
  const [phase, setPhase] = useState<LiquidMorphPhase>(() => {
    if (isOpen) return "expanded_p2";
    return hasSatellite ? "idle_split" : "idle_single";
  });

  const timer1Ref = useRef<number | null>(null);
  const timer2Ref = useRef<number | null>(null);
  const prevIsOpenRef = useRef(isOpen);
  const prevHasSatelliteRef = useRef(hasSatellite);

  const clearAllTimers = useCallback(() => {
    if (timer1Ref.current !== null) {
      window.clearTimeout(timer1Ref.current);
      timer1Ref.current = null;
    }
    if (timer2Ref.current !== null) {
      window.clearTimeout(timer2Ref.current);
      timer2Ref.current = null;
    }
  }, []);

  const fastForwardToExpanded = useCallback(() => {
    clearAllTimers();
    setPhase("expanded_p2");
    onOpenChange?.(true);
  }, [clearAllTimers, onOpenChange]);

  const requestOpen = useCallback(() => {
    if (phase === "expanded_p2") return;
    clearAllTimers();
    onOpenChange?.(true);

    if (isReducedMotionPreferred()) {
      setPhase("expanded_p2");
      return;
    }

    if (hasSatellite) {
      setPhase("merging_p1");
      timer1Ref.current = window.setTimeout(() => {
        setPhase("expanded_p2");
        timer1Ref.current = null;
      }, LIQUID_TIMINGS.MERGE_P1_MS);
    } else {
      setPhase("expanded_p2");
    }
  }, [clearAllTimers, hasSatellite, onOpenChange, phase]);

  const requestClose = useCallback(() => {
    if (phase === "idle_split" || phase === "idle_single") return;
    clearAllTimers();
    onOpenChange?.(false);

    if (isReducedMotionPreferred()) {
      setPhase(hasSatellite ? "idle_split" : "idle_single");
      return;
    }

    setPhase("collapsing_p1");
    timer1Ref.current = window.setTimeout(() => {
      if (hasSatellite) {
        setPhase("detaching_p2");
        timer2Ref.current = window.setTimeout(() => {
          setPhase("idle_split");
          timer2Ref.current = null;
        }, LIQUID_TIMINGS.DETACH_P2_MS);
      } else {
        setPhase("idle_single");
      }
      timer1Ref.current = null;
    }, LIQUID_TIMINGS.COLLAPSE_P1_MS);
  }, [clearAllTimers, hasSatellite, onOpenChange, phase]);

  useEffect(() => {
    // Detect external isOpen changes (e.g. from parent or shortcuts)
    if (isOpen !== prevIsOpenRef.current) {
      prevIsOpenRef.current = isOpen;
      if (isOpen) {
        requestOpen();
      } else {
        requestClose();
      }
    }
  }, [isOpen, requestOpen, requestClose]);

  useEffect(() => {
    // Synchronize resting state if satellite presence changes while closed
    if (hasSatellite !== prevHasSatelliteRef.current) {
      prevHasSatelliteRef.current = hasSatellite;
      if (!isOpen && (phase === "idle_split" || phase === "idle_single")) {
        setPhase(hasSatellite ? "idle_split" : "idle_single");
      }
    }
  }, [hasSatellite, isOpen, phase]);

  useEffect(() => {
    return () => clearAllTimers();
  }, [clearAllTimers]);

  const isExpanded = phase === "expanded_p2";
  const isMerging = phase === "merging_p1";
  const isCollapsing = phase === "collapsing_p1";
  const isDetaching = phase === "detaching_p2";
  const isRenderedSatellite =
    hasSatellite && (phase === "idle_split" || phase === "merging_p1" || phase === "detaching_p2");

  const satelliteAnimationClass = getSatelliteLiquidClass(phase, hasSatellite);
  const capsuleMorphClass = getCapsuleLiquidMorphClass(phase, hasSatellite, isOpen);

  return {
    phase,
    isExpanded,
    isMerging,
    isCollapsing,
    isDetaching,
    isRenderedSatellite,
    satelliteAnimationClass,
    capsuleMorphClass,
    requestOpen,
    requestClose,
    fastForwardToExpanded,
  };
}
