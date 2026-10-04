import type { CSSProperties } from "react";
import type {
  DynamicIslandCapsuleKind,
  DynamicIslandTone,
  DynamicIslandAuraTheme,
  DynamicIslandHubTab,
  DynamicIslandStateKind,
} from "./dynamic-island-types";

// ============================================================================
// Core Types for Dynamic Aura Engine
// ============================================================================

export interface DynamicIslandAuraStyles {
  theme: DynamicIslandAuraTheme;
  primaryColor: string;
  primaryRgba: string;
  glowRgba: string;
  glowBoxShadow: string;
  // Border tokens
  borderClass: string;
  borderHoverClass: string;
  hubBorderClass: string;
  // Shadow aura tokens
  shadowClass: string;
  hubShadowClass: string;
  shadowAura: string;
  // Component styling tokens
  defaultTab: DynamicIslandHubTab;
  tabActiveClass: string;
  buttonClass: string;
  accentButton: string;
  badgeBgClass: string;
  badgeTextClass: string;
  dotClass: string;
  satelliteGlowClass: string;
}

// ============================================================================
// Precomputed Dynamic Aura Theme Specifications
// ============================================================================

export const DYNAMIC_ISLAND_AURA_THEMES: Record<DynamicIslandAuraTheme, DynamicIslandAuraStyles> = {
  indigo: {
    theme: "indigo",
    primaryColor: "#6366f1",
    primaryRgba: "rgba(99, 102, 241, 1)",
    glowRgba: "rgba(99, 102, 241, 0.22)",
    glowBoxShadow: "0 12px 40px rgba(99, 102, 241, 0.22), 0 0 24px rgba(99, 102, 241, 0.28)",
    borderClass: "border-indigo-500/30",
    borderHoverClass: "hover:border-indigo-500/50",
    hubBorderClass: "border-indigo-500/40 ring-1 ring-indigo-400/30",
    shadowClass: "shadow-[0_12px_40px_rgba(99,102,241,0.22)]",
    hubShadowClass: "shadow-[0_12px_40px_rgba(99,102,241,0.22)] shadow-[0_0_32px_rgba(99,102,241,0.20)]",
    shadowAura: "0 12px 40px rgba(99, 102, 241, 0.22), 0 0 24px rgba(99, 102, 241, 0.28)",
    defaultTab: "evening",
    tabActiveClass: "bg-indigo-500/20 text-indigo-200 border-indigo-400/40 ring-1 ring-indigo-400/30 shadow-[0_0_12px_rgba(99,102,241,0.25)]",
    buttonClass: "bg-indigo-500 hover:bg-indigo-400 text-white shadow-indigo-500/20 shadow-[0_0_12px_rgba(99,102,241,0.25)]",
    accentButton: "bg-indigo-500 hover:bg-indigo-400 text-white shadow-indigo-500/20 shadow-[0_0_12px_rgba(99,102,241,0.25)]",
    badgeBgClass: "bg-indigo-500/15",
    badgeTextClass: "text-indigo-200",
    dotClass: "bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.8)]",
    satelliteGlowClass: "border-indigo-400/50 bg-indigo-500/20 text-indigo-200 shadow-[0_0_16px_rgba(99,102,241,0.45)] ring-1 ring-indigo-400/30",
  },
  amber: {
    theme: "amber",
    primaryColor: "#f59e0b",
    primaryRgba: "rgba(245, 158, 11, 1)",
    glowRgba: "rgba(245, 158, 11, 0.22)",
    glowBoxShadow: "0 12px 40px rgba(245, 158, 11, 0.22), 0 0 24px rgba(245, 158, 11, 0.28)",
    borderClass: "border-amber-500/30",
    borderHoverClass: "hover:border-amber-500/50",
    hubBorderClass: "border-amber-500/40 ring-1 ring-amber-400/30",
    shadowClass: "shadow-[0_12px_40px_rgba(245,158,11,0.22)]",
    hubShadowClass: "shadow-[0_12px_40px_rgba(245,158,11,0.22)] shadow-[0_0_32px_rgba(245,158,11,0.20)]",
    shadowAura: "0 12px 40px rgba(245, 158, 11, 0.22), 0 0 24px rgba(245, 158, 11, 0.28)",
    defaultTab: "status",
    tabActiveClass: "bg-amber-500/20 text-amber-200 border-amber-400/40 ring-1 ring-amber-400/30 shadow-[0_0_12px_rgba(245,158,11,0.25)]",
    buttonClass: "bg-amber-500 hover:bg-amber-400 text-black shadow-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.25)]",
    accentButton: "bg-amber-500 hover:bg-amber-400 text-black shadow-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.25)]",
    badgeBgClass: "bg-amber-500/15",
    badgeTextClass: "text-amber-200",
    dotClass: "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]",
    satelliteGlowClass: "border-amber-400/50 bg-amber-500/20 text-amber-200 shadow-[0_0_16px_rgba(245,158,11,0.45)] ring-1 ring-amber-400/30",
  },
  teal: {
    theme: "teal",
    primaryColor: "#14b8a6",
    primaryRgba: "rgba(20, 184, 166, 1)",
    glowRgba: "rgba(20, 184, 166, 0.22)",
    glowBoxShadow: "0 12px 40px rgba(20, 184, 166, 0.22), 0 0 24px rgba(20, 184, 166, 0.28)",
    borderClass: "border-teal-500/30",
    borderHoverClass: "hover:border-teal-500/50",
    hubBorderClass: "border-teal-500/40 ring-1 ring-teal-400/30",
    shadowClass: "shadow-[0_12px_40px_rgba(20,184,166,0.22)]",
    hubShadowClass: "shadow-[0_12px_40px_rgba(20,184,166,0.22)] shadow-[0_0_32px_rgba(20,184,166,0.20)]",
    shadowAura: "0 12px 40px rgba(20, 184, 166, 0.22), 0 0 24px rgba(20, 184, 166, 0.28)",
    defaultTab: "stopwatch",
    tabActiveClass: "bg-teal-500/20 text-teal-200 border-teal-400/40 ring-1 ring-teal-400/30 shadow-[0_0_12px_rgba(20,184,166,0.25)]",
    buttonClass: "bg-teal-500 hover:bg-teal-400 text-black shadow-teal-500/20 shadow-[0_0_12px_rgba(20,184,166,0.25)]",
    accentButton: "bg-teal-500 hover:bg-teal-400 text-black shadow-teal-500/20 shadow-[0_0_12px_rgba(20,184,166,0.25)]",
    badgeBgClass: "bg-teal-500/15",
    badgeTextClass: "text-teal-200",
    dotClass: "bg-teal-400 shadow-[0_0_8px_rgba(20,184,166,0.8)]",
    satelliteGlowClass: "border-teal-400/50 bg-teal-500/20 text-teal-200 shadow-[0_0_16px_rgba(20,184,166,0.45)] ring-1 ring-teal-400/30",
  },
  silver: {
    theme: "silver",
    primaryColor: "#94a3b8",
    primaryRgba: "rgba(148, 163, 184, 1)",
    glowRgba: "rgba(255, 255, 255, 0.06)",
    glowBoxShadow: "0 12px 40px rgba(0, 0, 0, 0.5), 0 0 20px rgba(255, 255, 255, 0.06)",
    borderClass: "border-white/10",
    borderHoverClass: "hover:border-white/20",
    hubBorderClass: "border-white/15 ring-1 ring-white/10",
    shadowClass: "shadow-[0_12px_40px_rgba(0,0,0,0.5)]",
    hubShadowClass: "shadow-[0_12px_40px_rgba(0,0,0,0.5)] shadow-[0_0_24px_rgba(255,255,255,0.06)]",
    shadowAura: "0 12px 40px rgba(0, 0, 0, 0.5), 0 0 20px rgba(255, 255, 255, 0.06)",
    defaultTab: "search",
    tabActiveClass: "bg-white/10 text-white border-white/20 ring-1 ring-white/10 shadow-[0_0_12px_rgba(255,255,255,0.08)]",
    buttonClass: "bg-white/10 hover:bg-white/20 text-white shadow-white/10",
    accentButton: "bg-white/10 hover:bg-white/20 text-white shadow-white/10",
    badgeBgClass: "bg-white/5",
    badgeTextClass: "text-zinc-400",
    dotClass: "bg-zinc-400",
    satelliteGlowClass: "border-white/20 bg-white/10 text-white shadow-[0_0_12px_rgba(255,255,255,0.15)] ring-1 ring-white/10",
  },
};

// ============================================================================
// Public Helper Functions for Dynamic Aura Engine
// ============================================================================

/**
 * Maps a state kind to its corresponding Dynamic Aura Theme.
 */
export function getAuraThemeForStateKind(
  kind?: DynamicIslandStateKind | DynamicIslandCapsuleKind | null
): DynamicIslandAuraTheme {
  switch (kind) {
    case "evening_review_due":
      return "indigo";
    case "recovery_active":
    case "sync_issue":
    case "confirmations_pending":
      return "amber";
    case "live_session_running":
    case "live_session_closing":
    case "activity_paused":
      return "teal";
    case "idle":
    case "command_search":
    default:
      return "silver";
  }
}

/**
 * Alias for getAuraThemeForStateKind.
 */
export const getAuraThemeFromKind = getAuraThemeForStateKind;

/**
 * Returns the complete Dynamic Aura styling tokens for a given theme or state kind.
 */
export function getAuraStyles(
  themeOrKind: DynamicIslandAuraTheme | DynamicIslandStateKind | DynamicIslandCapsuleKind
): DynamicIslandAuraStyles {
  const theme: DynamicIslandAuraTheme =
    Object.prototype.hasOwnProperty.call(DYNAMIC_ISLAND_AURA_THEMES, themeOrKind)
      ? (themeOrKind as DynamicIslandAuraTheme)
      : getAuraThemeForStateKind(themeOrKind as DynamicIslandStateKind);

  return DYNAMIC_ISLAND_AURA_THEMES[theme] ?? DYNAMIC_ISLAND_AURA_THEMES.silver;
}

/**
 * Returns the default active Hub tab for a given state kind.
 */
export function getDefaultTabForStateKind(
  kind?: DynamicIslandStateKind | DynamicIslandCapsuleKind | null
): DynamicIslandHubTab {
  switch (kind) {
    case "evening_review_due":
      return "evening";
    case "recovery_active":
    case "sync_issue":
    case "confirmations_pending":
      return "status";
    case "live_session_running":
    case "live_session_closing":
    case "activity_paused":
      return "stopwatch";
    case "idle":
    case "command_search":
    default:
      return "search";
  }
}

/**
 * Alias for getDefaultTabForStateKind.
 */
export const getDefaultHubTabForKind = getDefaultTabForStateKind;

/**
 * Returns the Tailwind CSS classes for the expanded console hub shell.
 */
export function getExpandedHubAuraClass(
  themeOrKind: DynamicIslandAuraTheme | DynamicIslandStateKind | DynamicIslandCapsuleKind
): string {
  const styles = getAuraStyles(themeOrKind);
  return `${styles.hubBorderClass} ${styles.hubShadowClass}`;
}

/**
 * Returns the Tailwind CSS classes for the dual-task exclamation satellite bubble.
 */
export function getSatelliteBubbleGlowClass(
  themeOrKind: DynamicIslandAuraTheme | DynamicIslandStateKind | DynamicIslandCapsuleKind
): string {
  const styles = getAuraStyles(themeOrKind);
  return styles.satelliteGlowClass;
}

// ============================================================================
// Backward Compatibility Layer for Existing Tone System
// ============================================================================

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
    Object.prototype.hasOwnProperty.call(TONE_COLOR_SPECS, kindOrTone)
      ? kindOrTone
      : getToneFromCapsuleKind(kindOrTone as DynamicIslandCapsuleKind)
  ) as DynamicIslandTone;

  const spec = getCapsuleToneColors(tone);

  return {
    "--af-capsule-glow-color": spec.primaryRgba,
    "--af-capsule-glow-shadow": spec.glowRgba,
  } as CSSProperties;
}

