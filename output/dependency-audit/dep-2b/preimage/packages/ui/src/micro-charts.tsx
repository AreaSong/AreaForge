"use client";

import React, { useId } from "react";

// ============================================================================
// 1. HourlyHeatbar — 24-slot horizontal mini bar chart (0-23h study density)
// ============================================================================

export interface HourlyHeatbarProps {
  slots?: number[];
  hourlyMinutes?: number[];
  maxSlotValue?: number;
  height?: number;
  currentHour?: number;
  className?: string;
  activeColor?: string;
  showLabels?: boolean;
  onSlotClick?: (hour: number, minutes: number) => void;
}

export function HourlyHeatbar({
  slots,
  hourlyMinutes,
  maxSlotValue,
  height = 24,
  currentHour,
  className = "",
  showLabels = true,
  onSlotClick,
}: HourlyHeatbarProps) {
  const data = slots ?? hourlyMinutes ?? Array(24).fill(0);
  const normalizedData = Array.from({ length: 24 }, (_, i) => data[i] ?? 0);
  const maxMinutes = maxSlotValue ?? Math.max(1, ...normalizedData);

  return (
    <div
      className={`flex flex-col gap-1 ${className}`.trim()}
      role="region"
      aria-label="24小时学习时段分布热力条"
    >
      <div
        className="flex items-end gap-0.5 rounded-lg border border-white/10 bg-black/40 p-1.5 backdrop-blur-sm"
        style={{ height: `${height + 12}px` }}
      >
        {normalizedData.map((minutes, hour) => {
          const heightPct =
            minutes > 0
              ? Math.max(20, Math.min(100, Math.round((minutes / maxMinutes) * 100)))
              : 12;
          const isCurrent = hour === currentHour;

          return (
            <div
              key={hour}
              className="group relative flex h-full flex-1 cursor-pointer items-end justify-center"
              title={`${String(hour).padStart(2, "0")}:00 - ${minutes} 分钟`}
              onClick={() => onSlotClick?.(hour, minutes)}
              tabIndex={0}
              role="button"
              aria-label={`${hour}点: ${minutes}分钟`}
            >
              <div
                className={`w-full rounded-xs transition-all duration-200 ${
                  minutes > 0
                    ? isCurrent
                      ? "bg-teal-300 shadow-[0_0_8px_rgba(45,212,191,0.9)] ring-1 ring-teal-200"
                      : "bg-teal-500/80 hover:bg-teal-300 hover:shadow-[0_0_6px_rgba(45,212,191,0.6)]"
                    : isCurrent
                      ? "bg-white/25 ring-1 ring-white/40"
                      : "bg-white/[0.05] hover:bg-white/15"
                }`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          );
        })}
      </div>

      {showLabels ? (
        <div className="flex justify-between px-1 text-[9px] font-mono text-zinc-500 select-none">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:00</span>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// 2. SubjectProportionBar — Segmented horizontal progress bar per subject
// ============================================================================

export interface SubjectProportionItem {
  id?: string;
  subjectId?: string;
  name?: string;
  title?: string;
  durationMinutes?: number;
  minutes?: number;
  value?: number;
  color?: string;
  colorClass?: string;
}

export interface SubjectProportionBarProps {
  items: SubjectProportionItem[];
  totalMinutes?: number;
  height?: number;
  showLegend?: boolean;
  maxLegendItems?: number;
  className?: string;
}

const DEFAULT_SUBJECT_COLORS = [
  "bg-teal-400",
  "bg-sky-400",
  "bg-amber-400",
  "bg-emerald-400",
  "bg-purple-400",
  "bg-rose-400",
  "bg-indigo-400",
  "bg-pink-400",
];

export function SubjectProportionBar({
  items,
  totalMinutes,
  height = 6,
  showLegend = true,
  maxLegendItems = 6,
  className = "",
}: SubjectProportionBarProps) {
  const normalizedItems = items.map((item, idx) => {
    const id = item.id ?? item.subjectId ?? `subject-${idx}`;
    const title = item.name ?? item.title ?? `科目 ${idx + 1}`;
    const mins = item.durationMinutes ?? item.minutes ?? item.value ?? 0;
    const color = item.colorClass ?? item.color ?? DEFAULT_SUBJECT_COLORS[idx % DEFAULT_SUBJECT_COLORS.length];
    return { id, title, minutes: mins, color };
  });

  const calculatedTotal =
    totalMinutes ??
    normalizedItems.reduce((acc, item) => acc + item.minutes, 0);

  if (calculatedTotal <= 0) {
    return (
      <div className={`space-y-1.5 ${className}`.trim()}>
        <div
          className="w-full overflow-hidden rounded-full bg-white/5"
          style={{ height: `${height}px` }}
        />
        {showLegend ? (
          <p className="text-[10px] text-zinc-500 font-mono">暂无科目投入数据</p>
        ) : null}
      </div>
    );
  }

  const activeItems = normalizedItems.filter((item) => item.minutes > 0);
  const legendItems = activeItems.slice(0, maxLegendItems);

  return (
    <div className={`space-y-1.5 ${className}`.trim()} role="region" aria-label="学科投入占比进度条">
      <div
        className="flex w-full overflow-hidden rounded-full bg-white/5 gap-0.5"
        style={{ height: `${height}px` }}
      >
        {activeItems.map((item) => {
          const pct = ((item.minutes / calculatedTotal) * 100).toFixed(1);
          return (
            <div
              key={item.id}
              style={{ width: `${pct}%` }}
              className={`h-full ${item.color} transition-all duration-300 rounded-full hover:opacity-90`}
              title={`${item.title}: ${item.minutes}分钟 (${pct}%)`}
            />
          );
        })}
      </div>

      {showLegend && legendItems.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-400">
          {legendItems.map((item) => {
            const pct = Math.round((item.minutes / calculatedTotal) * 100);
            return (
              <span key={item.id} className="flex items-center gap-1.5">
                <span className={`size-1.5 shrink-0 rounded-full ${item.color}`} />
                <span className="truncate max-w-[90px] text-zinc-300">{item.title}</span>
                <span className="font-mono text-zinc-500">{item.minutes}m ({pct}%)</span>
              </span>
            );
          })}
          {activeItems.length > maxLegendItems ? (
            <span className="text-[9px] font-mono text-zinc-500">
              +{activeItems.length - maxLegendItems} 更多
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// 3. CompactBadge — Ultra-compact badge (18-20px) with color variants
// ============================================================================

export type CompactBadgeVariant =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "neutral"
  | "glow"
  | "info";

export type CompactBadgeTone =
  | "teal"
  | "emerald"
  | "amber"
  | "rose"
  | "zinc"
  | "sky"
  | "purple";

export type CompactBadgeSize = "xs" | "sm";

export interface CompactBadgeProps {
  variant?: CompactBadgeVariant;
  tone?: CompactBadgeTone;
  size?: CompactBadgeSize;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const BADGE_VARIANT_CLASSES: Record<CompactBadgeVariant, string> = {
  primary: "bg-teal-400/10 text-teal-300 border-teal-500/20 shadow-[0_0_8px_rgba(45,212,191,0.12)]",
  glow: "bg-teal-400/15 text-teal-200 border-teal-400/40 shadow-[0_0_12px_rgba(45,212,191,0.25)] font-semibold",
  success: "bg-emerald-400/10 text-emerald-300 border-emerald-500/20 shadow-[0_0_8px_rgba(52,211,153,0.12)]",
  warning: "bg-amber-400/10 text-amber-300 border-amber-500/20 shadow-[0_0_8px_rgba(251,191,36,0.12)]",
  danger: "bg-rose-500/10 text-rose-300 border-rose-500/20 shadow-[0_0_8px_rgba(244,63,94,0.12)]",
  info: "bg-sky-500/10 text-sky-300 border-sky-500/20 shadow-[0_0_8px_rgba(56,189,248,0.12)]",
  neutral: "bg-white/[0.04] text-zinc-400 border-white/10",
};

const TONE_TO_VARIANT_MAP: Record<CompactBadgeTone, CompactBadgeVariant> = {
  teal: "primary",
  emerald: "success",
  amber: "warning",
  rose: "danger",
  zinc: "neutral",
  sky: "info",
  purple: "info",
};

const BADGE_SIZE_CLASSES: Record<CompactBadgeSize, string> = {
  xs: "h-[18px] px-1.5 text-[10px] gap-1",
  sm: "h-[22px] px-2 text-xs gap-1.5",
};

export function CompactBadge({
  variant,
  tone,
  size = "xs",
  icon,
  children,
  className = "",
}: CompactBadgeProps) {
  const resolvedVariant = variant ?? (tone ? TONE_TO_VARIANT_MAP[tone] : "neutral");
  const variantClass = BADGE_VARIANT_CLASSES[resolvedVariant] ?? BADGE_VARIANT_CLASSES.neutral;
  const sizeClass = BADGE_SIZE_CLASSES[size] ?? BADGE_SIZE_CLASSES.xs;

  return (
    <span
      className={`inline-flex items-center justify-center font-medium leading-none rounded border select-none transition-colors ${variantClass} ${sizeClass} ${className}`.trim()}
    >
      {icon ? <span className="shrink-0 flex items-center">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

// ============================================================================
// 4. StatusDot — Glowing pulsating/static micro-dot for live activity
// ============================================================================

export type StatusDotStatus = "active" | "warning" | "idle" | "danger" | "success" | "info";
export type StatusDotTone = "teal" | "emerald" | "amber" | "rose" | "zinc" | "sky";
export type StatusDotSize = "xs" | "sm" | "md";

export interface StatusDotProps {
  status?: StatusDotStatus;
  tone?: StatusDotTone;
  pulse?: boolean;
  size?: StatusDotSize;
  title?: string;
  className?: string;
}

const STATUS_DOT_COLORS: Record<StatusDotStatus, { core: string; ping: string }> = {
  active: {
    core: "bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.85)]",
    ping: "bg-teal-400 opacity-75",
  },
  success: {
    core: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.85)]",
    ping: "bg-emerald-400 opacity-75",
  },
  warning: {
    core: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.85)]",
    ping: "bg-amber-400 opacity-75",
  },
  danger: {
    core: "bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.85)]",
    ping: "bg-rose-400 opacity-75",
  },
  info: {
    core: "bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.85)]",
    ping: "bg-sky-400 opacity-75",
  },
  idle: {
    core: "bg-zinc-600 shadow-none",
    ping: "bg-zinc-500 opacity-40",
  },
};

const TONE_TO_STATUS: Record<StatusDotTone, StatusDotStatus> = {
  teal: "active",
  emerald: "success",
  amber: "warning",
  rose: "danger",
  zinc: "idle",
  sky: "info",
};

const DOT_SIZE_MAP: Record<StatusDotSize, { wrapper: string; dot: string }> = {
  xs: { wrapper: "size-2", dot: "size-1" },
  sm: { wrapper: "size-2.5", dot: "size-1.5" },
  md: { wrapper: "size-3.5", dot: "size-2" },
};

export function StatusDot({
  status,
  tone,
  pulse = false,
  size = "sm",
  title,
  className = "",
}: StatusDotProps) {
  const resolvedStatus = status ?? (tone ? TONE_TO_STATUS[tone] : "idle");
  const color = STATUS_DOT_COLORS[resolvedStatus] ?? STATUS_DOT_COLORS.idle;
  const sizeConfig = DOT_SIZE_MAP[size] ?? DOT_SIZE_MAP.sm;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${sizeConfig.wrapper} ${className}`.trim()}
      title={title ?? resolvedStatus}
      aria-label={title ?? `状态: ${resolvedStatus}`}
    >
      {pulse ? (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color.ping}`}
        />
      ) : null}
      <span className={`relative inline-flex rounded-full ${sizeConfig.dot} ${color.core}`} />
    </span>
  );
}

// ============================================================================
// 5. MiniSparkline — Lightweight SVG line/area sparkline with target support
// ============================================================================

function useSafeId(prefix = "sparkline-grad"): string {
  try {
    if (typeof React.useId === "function") {
      const hookId = React.useId();
      if (hookId) return hookId;
    }
  } catch {
    // Fallback for node test runner execution outside React render tree
  }
  return prefix;
}

export interface MiniSparklineProps {
  data: number[];
  id?: string;
  targetValue?: number;
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  strokeWidth?: number;
  showLastPoint?: boolean;
  showTarget?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function MiniSparkline({
  data,
  id,
  targetValue,
  color = "#2dd4bf",
  width = 120,
  height = 28,
  fill = true,
  strokeWidth = 1.5,
  showLastPoint = true,
  showTarget = true,
  className = "",
  ariaLabel = "趋势折线图",
}: MiniSparklineProps) {
  const safeId = useSafeId();
  const gradientId = id ?? safeId;

  if (!data || data.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-[10px] text-zinc-600 font-mono ${className}`.trim()}
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        --
      </div>
    );
  }

  const pad = 3;
  const allValues = targetValue !== undefined ? [...data, targetValue] : data;
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal === minVal ? 1 : maxVal - minVal;

  const getX = (index: number) => {
    if (data.length <= 1) return width / 2;
    return pad + (index / (data.length - 1)) * (width - 2 * pad);
  };

  const getY = (val: number) => {
    return height - pad - ((val - minVal) / range) * (height - 2 * pad);
  };

  // Generate polyline points
  const points = data.map((val, idx) => `${getX(idx)},${getY(val)}`).join(" ");

  // Generate SVG area path
  const areaPath =
    data.length > 1
      ? `M ${getX(0)},${getY(data[0])} ` +
        data.slice(1).map((val, idx) => `L ${getX(idx + 1)},${getY(val)}`).join(" ") +
        ` L ${getX(data.length - 1)},${height} L ${getX(0)},${height} Z`
      : "";

  const lastIndex = data.length - 1;
  const lastX = getX(lastIndex);
  const lastY = getY(data[lastIndex]);

  const targetY = targetValue !== undefined ? getY(targetValue) : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`overflow-visible select-none ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0.0} />
        </linearGradient>
      </defs>

      {/* Target baseline */}
      {showTarget && targetY !== null ? (
        <line
          x1={pad}
          y1={targetY}
          x2={width - pad}
          y2={targetY}
          stroke="#fbbf24"
          strokeWidth="1"
          strokeDasharray="2,2"
          strokeOpacity="0.6"
        />
      ) : null}

      {/* Area fill */}
      {fill && areaPath ? (
        <path d={areaPath} fill={`url(#${gradientId})`} />
      ) : null}

      {/* Main trend line */}
      {data.length > 1 ? (
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <line
          x1={pad}
          y1={lastY}
          x2={width - pad}
          y2={lastY}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray="2,2"
        />
      )}

      {/* Glowing terminal dot */}
      {showLastPoint ? (
        <>
          <circle cx={lastX} cy={lastY} r="4" fill={color} opacity="0.25" />
          <circle cx={lastX} cy={lastY} r="2" fill={color} />
        </>
      ) : null}
    </svg>
  );
}

// ============================================================================
// 6. MiniRadar — Multi-axis SVG radar chart for subject mastery
// ============================================================================

export interface RadarAxis {
  label: string;
  value: number;
  max?: number;
}

export interface MiniRadarProps {
  axes: RadarAxis[];
  size?: number;
  color?: string;
  fillOpacity?: number;
  showLabels?: boolean;
  showGrid?: boolean;
  gridLevels?: number;
  className?: string;
  ariaLabel?: string;
}

export function MiniRadar({
  axes,
  size = 110,
  color = "#2dd4bf",
  fillOpacity = 0.25,
  showLabels = true,
  showGrid = true,
  gridLevels = 3,
  className = "",
  ariaLabel = "学科掌握度雷达图",
}: MiniRadarProps) {
  const count = axes.length;

  if (count < 3) {
    return (
      <div
        className={`flex items-center justify-center text-[10px] text-zinc-500 font-mono ${className}`.trim()}
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        需至少3个维度
      </div>
    );
  }

  const cx = size / 2;
  const cy = size / 2;
  const radius = Math.max(15, size / 2 - (showLabels ? 18 : 6));

  const getAngle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / count;

  // Grid levels (e.g. 0.33, 0.67, 1.0)
  const levels = Array.from({ length: gridLevels }, (_, i) => (i + 1) / gridLevels);

  // Compute value polygon points
  const valuePoints = axes
    .map((axis, i) => {
      const angle = getAngle(i);
      const max = axis.max ?? 100;
      const normalized = Math.max(0, Math.min(1, max > 0 ? axis.value / max : 0));
      const r = radius * normalized;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`overflow-visible select-none ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      {/* Background grid concentric polygons */}
      {showGrid ? (
        <>
          {levels.map((lvl, idx) => {
            const gridPts = Array.from({ length: count }, (_, i) => {
              const angle = getAngle(i);
              const r = radius * lvl;
              const x = cx + r * Math.cos(angle);
              const y = cy + r * Math.sin(angle);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(" ");

            return (
              <polygon
                key={idx}
                points={gridPts}
                fill="none"
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="1"
              />
            );
          })}

          {/* Axis spoke lines */}
          {axes.map((_, i) => {
            const angle = getAngle(i);
            const x2 = cx + radius * Math.cos(angle);
            const y2 = cy + radius * Math.sin(angle);
            return (
              <line
                key={i}
                x1={cx}
                y1={cy}
                x2={x2}
                y2={y2}
                stroke="rgba(255, 255, 255, 0.10)"
                strokeWidth="1"
              />
            );
          })}
        </>
      ) : null}

      {/* Filled data polygon */}
      <polygon
        points={valuePoints}
        fill={color}
        fillOpacity={fillOpacity}
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Vertex dots */}
      {axes.map((axis, i) => {
        const angle = getAngle(i);
        const max = axis.max ?? 100;
        const normalized = Math.max(0, Math.min(1, max > 0 ? axis.value / max : 0));
        const r = radius * normalized;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="2"
            fill={color}
            stroke="#0e1619"
            strokeWidth="1"
          />
        );
      })}

      {/* Axis text labels */}
      {showLabels
        ? axes.map((axis, i) => {
            const angle = getAngle(i);
            const labelR = radius + 11;
            const x = cx + labelR * Math.cos(angle);
            const y = cy + labelR * Math.sin(angle);

            // Determine text anchor based on angle
            let textAnchor: "middle" | "start" | "end" = "middle";
            const cos = Math.cos(angle);
            if (cos > 0.3) textAnchor = "start";
            else if (cos < -0.3) textAnchor = "end";

            return (
              <text
                key={i}
                x={x}
                y={y + 3}
                textAnchor={textAnchor}
                fontSize="9"
                fill="#a1a1aa"
                className="font-medium"
              >
                {axis.label}
              </text>
            );
          })
        : null}
    </svg>
  );
}
