/**
 * AreaForge Design System Tokens
 * 
 * Centralized design tokens for surface containers, form controls, typography,
 * brand accents, glowing elevation, and ergonomic geometry.
 * Aligned with the /focus high-texture dark glass workstation standard.
 */

export const colors = {
  canvas: "#080b0f",
  surface: {
    base: "#101419",
    panel: "#0d1117",
    card: "#0e1619",
    cardAlpha: "rgba(14, 22, 25, 0.90)",
    subtle: "rgba(255, 255, 255, 0.02)",
    raised: "#151a20",
  },
  border: {
    subtle: "rgba(255, 255, 255, 0.05)",
    default: "rgba(255, 255, 255, 0.10)",
    strong: "rgba(255, 255, 255, 0.18)",
    accent: "rgba(45, 212, 191, 0.20)",
    accentStrong: "rgba(45, 212, 191, 0.80)",
  },
  text: {
    primary: "#f4f4f5",
    secondary: "#a1a1aa",
    muted: "#71717a",
    inverse: "#061012",
  },
  accent: {
    primary: "#2dd4bf", // Teal-400
    hover: "#5eead4", // Teal-300
    strong: "#14b8a6", // Teal-500
    activeBg: "rgba(20, 184, 166, 0.20)", // Teal-500/20
    flare: "rgba(45, 212, 191, 0.20)",
    glow: "rgba(45, 212, 191, 0.35)",
    glowHover: "rgba(45, 212, 191, 0.50)",
    // Legacy & semantic aliases
    forge: "#14b8a6",
    warning: "#f59e0b",
    danger: "#ef4444",
    progress: "#38bdf8",
  },
  status: {
    info: "#38bdf8",
    success: "#34d399",
    warning: "#fbbf24",
    danger: "#f87171",
  },
} as const;

export const radii = {
  xs: "4px",
  sm: "6px",
  md: "8px",
  control: "0.75rem", // 12px (rounded-xl) — buttons, inputs, segmented controls
  card: "1rem", // 16px (rounded-2xl) — master cards, dialogs, workstation frames
  surface: "1rem", // 16px (rounded-2xl) — alias for card surface
  lg: "0.75rem", // 12px
  xl: "0.75rem", // 12px
  "2xl": "1rem", // 16px
  full: "9999px",
} as const;

export const shadows = {
  card: "0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.5)",
  tealGlow: "0 0 20px rgba(45, 212, 191, 0.35)",
  tealGlowHover: "0 0 28px rgba(45, 212, 191, 0.50)",
  tealGlowSubtle: "0 0 12px rgba(45, 212, 191, 0.20)",
  tealGlowAccent: "0 0 16px rgba(45, 212, 191, 0.15)",
} as const;

export const heights = {
  controlSm: "2.25rem", // 36px (h-9)
  controlMd: "2.5rem", // 40px (h-10)
  controlLg: "2.75rem", // 44px (h-11)
  controlXl: "3rem", // 48px (h-12)
} as const;

export const layers = {
  shellBase: 20,
  pagePopover: 50,
  shellChrome: 70,
  shellPopover: 90,
  workspaceWindow: 100,
  selection: 110,
  modal: 120,
  critical: 140,
} as const;

export const transitions = {
  fast: "150ms cubic-bezier(0.16, 1, 0.3, 1)",
  normal: "200ms cubic-bezier(0.16, 1, 0.3, 1)",
  smooth: "300ms cubic-bezier(0.16, 1, 0.3, 1)",
  scaleActive: "scale(0.98)",
} as const;

/**
 * Unified areaForgeTokens export for full backward compatibility and system-wide access.
 */
export const areaForgeTokens = {
  colors,
  radius: radii,
  shadows,
  heights,
  layers,
  transitions,
  // Direct access aliases for legacy code:
  accent: colors.accent,
} as const;

export type AreaForgeTokens = typeof areaForgeTokens;
export type Colors = typeof colors;
export type Radii = typeof radii;
export type Shadows = typeof shadows;
export type Heights = typeof heights;
export type Layers = typeof layers;
export type Transitions = typeof transitions;
