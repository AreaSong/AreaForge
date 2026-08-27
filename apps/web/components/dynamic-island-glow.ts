import type { CSSProperties } from "react";
import type {
  DynamicIslandCapsuleKind,
  DynamicIslandTone,
} from "./dynamic-island-types";

export interface ToneColorSpec {
  primary: string;
  primaryRgba: string;
  glowRgba: string;
  borderClass: string;
  borderHoverClass: string;
  ringClass: string;
  shadowClass: string;
  dotClass: string;
  badgeBgClass: string;
  badgeTextClass: string;
}

export const TONE_COLOR_SPECS: Record<DynamicIslandTone, ToneColorSpec> = {
  teal: {
    primary: "#2dd4bf",
    primaryRgba: "rgba(45, 212, 191, 1)",
    glowRgba: "rgba(45, 212, 191, 0.22)",
    borderClass: "border-teal-500/40",
    borderHoverClass: "hover:border-teal-400/60",
    ringClass: "ring-1 ring-teal-400/20",
    shadowClass: "shadow-[0_0_20px_rgba(45,212,191,0.22)]",
    dotClass: "bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]",
    badgeBgClass: "bg-teal-500/15",
    badgeTextClass: "text-teal-200",
  },
  emerald: {
    primary: "#34d399",
    primaryRgba: "rgba(52, 211, 153, 1)",
    glowRgba: "rgba(52, 211, 153, 0.2)",
    borderClass: "border-emerald-500/40",
    borderHoverClass: "hover:border-emerald-400/60",
    ringClass: "ring-1 ring-emerald-400/20",
    shadowClass: "shadow-[0_0_16px_rgba(52,211,153,0.2)]",
    dotClass: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]",
    badgeBgClass: "bg-emerald-500/15",
    badgeTextClass: "text-emerald-200",
  },
  amber: {
    primary: "#fbbf24",
    primaryRgba: "rgba(251, 191, 36, 1)",
    glowRgba: "rgba(251, 191, 36, 0.18)",
    borderClass: "border-amber-400/40",
    borderHoverClass: "hover:border-amber-400/60",
    ringClass: "ring-1 ring-amber-400/20",
    shadowClass: "shadow-[0_0_18px_rgba(251,191,36,0.18)]",
    dotClass: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]",
    badgeBgClass: "bg-amber-500/15",
    badgeTextClass: "text-amber-200",
  },
  indigo: {
    primary: "#818cf8",
    primaryRgba: "rgba(129, 140, 248, 1)",
    glowRgba: "rgba(129, 140, 248, 0.2)",
    borderClass: "border-indigo-400/40",
    borderHoverClass: "hover:border-indigo-300/60",
    ringClass: "ring-1 ring-indigo-400/20",
    shadowClass: "shadow-[0_0_18px_rgba(129,140,248,0.2)]",
    dotClass: "bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]",
    badgeBgClass: "bg-indigo-500/15",
    badgeTextClass: "text-indigo-200",
  },
  rose: {
    primary: "#fb7185",
    primaryRgba: "rgba(251, 113, 133, 1)",
    glowRgba: "rgba(251, 113, 133, 0.22)",
    borderClass: "border-rose-500/40",
    borderHoverClass: "hover:border-rose-400/60",
    ringClass: "ring-1 ring-rose-400/20",
    shadowClass: "shadow-[0_0_18px_rgba(251,113,133,0.22)]",
    dotClass: "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]",
    badgeBgClass: "bg-rose-500/15",
    badgeTextClass: "text-rose-200",
  },
  zinc: {
    primary: "#a1a1aa",
    primaryRgba: "rgba(161, 161, 170, 1)",
    glowRgba: "rgba(255, 255, 255, 0.05)",
    borderClass: "border-white/10",
    borderHoverClass: "hover:border-teal-400/30 hover:bg-white/[0.04]",
    ringClass: "",
    shadowClass: "",
    dotClass: "bg-zinc-400",
    badgeBgClass: "bg-white/5",
    badgeTextClass: "text-zinc-400",
  },
};

/**
 * Maps a capsule kind to its default tone.
 */
export function getToneFromCapsuleKind(kind: DynamicIslandCapsuleKind): DynamicIslandTone {
  switch (kind) {
    case "live_session_running":
      return "teal";
    case "live_session_closing":
      return "emerald";
    case "activity_paused":
      return "amber";
    case "recovery_active":
      return "amber";
    case "evening_review_due":
      return "indigo";
    case "sync_issue":
      return "amber";
    case "confirmations_pending":
      return "amber";
    case "idle":
    default:
      return "zinc";
  }
}

/**
 * Returns color specification tokens for a tone.
 */
export function getCapsuleToneColors(tone: DynamicIslandTone): ToneColorSpec {
  return TONE_COLOR_SPECS[tone] ?? TONE_COLOR_SPECS.zinc;
}

/**
 * Returns the exact Tailwind CSS glow classes for a capsule kind or tone.
 * When isOpen is true, returns empty string because open container styling is owned by the expanded shell.
 */
export function getCapsuleGlowClass(
  kindOrTone: DynamicIslandCapsuleKind | DynamicIslandTone,
  isOpen: boolean = false
): string {
  if (isOpen) return "";

  switch (kindOrTone) {
    case "live_session_running":
    case "teal":
      return "border-teal-500/40 shadow-[0_0_20px_rgba(45,212,191,0.22)] ring-1 ring-teal-400/20 hover:border-teal-400/60";
    case "live_session_closing":
      return "border-emerald-500/40 shadow-[0_0_16px_rgba(52,211,153,0.2)] ring-1 ring-emerald-400/20 hover:border-emerald-400/60";
    case "activity_paused":
      return "border-emerald-500/35 shadow-[0_0_16px_rgba(52,211,153,0.15)] ring-1 ring-emerald-500/20 hover:border-emerald-400/50";
    case "recovery_active":
      return "border-amber-400/40 shadow-[0_0_18px_rgba(251,191,36,0.18)] ring-1 ring-amber-400/20 hover:border-amber-400/60";
    case "evening_review_due":
    case "indigo":
      return "border-indigo-400/40 shadow-[0_0_18px_rgba(129,140,248,0.2)] ring-1 ring-indigo-400/20 hover:border-indigo-300/60";
    case "sync_issue":
      return "border-amber-400/35 shadow-[0_0_16px_rgba(251,191,36,0.12)] hover:border-amber-400/50";
    case "confirmations_pending":
    case "amber":
      return "border-amber-400/40 shadow-[0_0_18px_rgba(251,191,36,0.18)] ring-1 ring-amber-400/20 hover:border-amber-400/60";
    case "rose":
      return "border-rose-500/40 shadow-[0_0_18px_rgba(251,113,133,0.22)] ring-1 ring-rose-400/20 hover:border-rose-400/60";
    case "emerald":
      return "border-emerald-500/40 shadow-[0_0_16px_rgba(52,211,153,0.2)] ring-1 ring-emerald-400/20 hover:border-emerald-400/60";
    case "idle":
    case "zinc":
    default:
      return "border-white/10 hover:border-teal-400/30 hover:bg-white/[0.04]";
  }
}

/**
 * Backward-compatible alias for getCapsuleGlowClass.
 */
export const getCapsuleGlowStyle = getCapsuleGlowClass;

/**
 * Returns dynamic inline CSS custom properties for fine micro-glow tuning.
 */
export function getCapsuleInlineStyle(
  kindOrTone: DynamicIslandCapsuleKind | DynamicIslandTone,
  isOpen: boolean = false
): CSSProperties {
  if (isOpen) return {};

  const tone = (
    kindOrTone in TONE_COLOR_SPECS
      ? kindOrTone
      : getToneFromCapsuleKind(kindOrTone as DynamicIslandCapsuleKind)
  ) as DynamicIslandTone;

  const spec = getCapsuleToneColors(tone);

  return {
    "--af-capsule-glow-color": spec.primaryRgba,
    "--af-capsule-glow-shadow": spec.glowRgba,
  } as CSSProperties;
}
