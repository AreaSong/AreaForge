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
  const hasAttribute = typeof document !== "undefined" && document.documentElement?.getAttribute("data-af-motion") === "reduce";
  return Boolean(mediaQuery?.matches || hasAttribute);
}

export function getSatelliteLiquidClass(phase: LiquidMorphPhase, hasSatellite: boolean = true): string {
  if (!hasSatellite) return "hidden opacity-0 pointer-events-none";
  switch (phase) {
    case "idle_split":
      return "opacity-100 transform-none af-satellite-visible";
    case "idle_single":
      return "hidden opacity-0 pointer-events-none";
    case "merging_p1":
      return "af-satellite-fusing pointer-events-none";
    case "expanded_p2":
      return "hidden opacity-0 pointer-events-none";
    case "collapsing_p1":
      return "hidden opacity-0 pointer-events-none";
    case "detaching_p2":
      return "af-satellite-detaching pointer-events-none";
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
      return `rounded-[18px] relative min-h-9 flex-1 cursor-pointer ${baseTransitions} duration-200`;
    case "idle_single":
      return `rounded-[18px] relative min-h-9 w-full flex-1 cursor-pointer ${baseTransitions} duration-200`;
    case "merging_p1":
      return `rounded-[18px] relative min-h-9 w-full flex-1 cursor-pointer ${baseTransitions} duration-[400ms] af-capsule-merged`;
    case "expanded_p2":
      return `rounded-[20px] relative min-h-9 w-full flex-1 z-20 ${baseTransitions} duration-[320ms] ring-1 ring-white/10`;
    case "collapsing_p1":
      return `rounded-[18px] relative min-h-9 w-full flex-1 z-20 ${baseTransitions} duration-[260ms] ring-1 ring-white/10`;
    case "detaching_p2":
      return `rounded-[18px] relative min-h-9 flex-1 cursor-pointer ${baseTransitions} duration-[360ms]`;
    default:
      return isOpen
        ? "rounded-[20px] relative min-h-9 w-full flex-1 z-20 ring-1 ring-white/10"
        : hasSatellite
          ? "rounded-[18px] relative min-h-9 flex-1 cursor-pointer"
          : "rounded-[18px] relative min-h-9 w-full flex-1 cursor-pointer";
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

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      if (phase !== "expanded_p2") {
        if (isReducedMotionPreferred()) {
          setPhase("expanded_p2");
        } else if (hasSatellite) {
          setPhase("merging_p1");
        } else {
          setPhase("expanded_p2");
        }
      }
    } else {
      if (phase !== "idle_split" && phase !== "idle_single") {
        if (isReducedMotionPreferred()) {
          setPhase(hasSatellite ? "idle_split" : "idle_single");
        } else {
          setPhase("collapsing_p1");
        }
      }
    }
  }

  const [prevHasSatellite, setPrevHasSatellite] = useState(hasSatellite);
  if (hasSatellite !== prevHasSatellite) {
    setPrevHasSatellite(hasSatellite);
    if (!isOpen && (phase === "idle_split" || phase === "idle_single")) {
      setPhase(hasSatellite ? "idle_split" : "idle_single");
    }
  }

  const fastForwardToExpanded = useCallback(() => {
    setPhase("expanded_p2");
    onOpenChange?.(true);
  }, [onOpenChange]);

  const requestOpen = useCallback(() => {
    if (phase === "expanded_p2") return;
    onOpenChange?.(true);

    if (isReducedMotionPreferred()) {
      setPhase("expanded_p2");
      return;
    }

    if (hasSatellite) {
      setPhase("merging_p1");
    } else {
      setPhase("expanded_p2");
    }
  }, [hasSatellite, onOpenChange, phase]);

  const requestClose = useCallback(() => {
    if (phase === "idle_split" || phase === "idle_single") return;
    onOpenChange?.(false);

    if (isReducedMotionPreferred()) {
      setPhase(hasSatellite ? "idle_split" : "idle_single");
      return;
    }

    setPhase("collapsing_p1");
  }, [hasSatellite, onOpenChange, phase]);

  useEffect(() => {
    if (phase === "merging_p1") {
      const timer = window.setTimeout(() => {
        setPhase("expanded_p2");
      }, LIQUID_TIMINGS.MERGE_P1_MS);
      return () => window.clearTimeout(timer);
    }
    if (phase === "collapsing_p1") {
      const timer = window.setTimeout(() => {
        if (hasSatellite) {
          setPhase("detaching_p2");
        } else {
          setPhase("idle_single");
        }
      }, LIQUID_TIMINGS.COLLAPSE_P1_MS);
      return () => window.clearTimeout(timer);
    }
    if (phase === "detaching_p2") {
      const timer = window.setTimeout(() => {
        setPhase("idle_split");
      }, LIQUID_TIMINGS.DETACH_P2_MS);
      return () => window.clearTimeout(timer);
    }
  }, [hasSatellite, phase]);

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
