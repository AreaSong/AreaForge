import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type MetricValueSize = "sm" | "base" | "lg" | "xl" | "2xl";
export type MetricTone = "neutral" | "muted" | "accent" | "info" | "success" | "warning" | "danger";
export type MetricLayout = "compact" | "default" | "tile";

const valueSizeClass: Record<MetricValueSize, string> = {
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
};

const layoutClass: Record<MetricLayout, string> = {
  compact: "px-3",
  default: "px-3 py-4",
  tile: "bg-[var(--af-surface-subtle)] p-4",
};

const toneClass: Record<MetricTone, { label: string; value: string }> = {
  neutral: { label: "text-zinc-500", value: "text-zinc-100" },
  muted: { label: "text-zinc-500", value: "text-zinc-300" },
  accent: { label: "text-teal-300", value: "text-white" },
  info: { label: "text-sky-300", value: "text-white" },
  success: { label: "text-emerald-300", value: "text-white" },
  warning: { label: "text-amber-300", value: "text-amber-50" },
  danger: { label: "text-red-300", value: "text-red-50" },
};

export function Metric(props: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  detail?: ReactNode;
  icon?: LucideIcon;
  className?: string;
  layout?: MetricLayout;
  tone?: MetricTone;
  valueSize?: MetricValueSize;
}) {
  const valueSize = props.valueSize ?? "xl";
  const layout = props.layout ?? "default";
  const tone = props.tone ?? "neutral";
  const Icon = props.icon;
  const detail = props.detail ?? props.note;
  return (
    <div className={`min-w-0 ${layoutClass[layout]} ${props.className ?? ""}`}>
      <dt className={`flex items-center gap-2 text-xs ${toneClass[tone].label}`}>
        {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
        {props.label}
      </dt>
      <dd className={`mt-1 break-words font-medium tabular-nums ${toneClass[tone].value} ${valueSizeClass[valueSize]}`}>
        {props.value}
        {detail !== undefined && detail !== null
          ? <span className="mt-1 block break-words text-xs font-normal leading-5 text-zinc-500">{detail}</span>
          : null}
      </dd>
    </div>
  );
}
