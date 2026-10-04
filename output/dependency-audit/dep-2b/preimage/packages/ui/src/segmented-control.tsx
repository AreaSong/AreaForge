import React, { type ReactNode } from "react";

export type SegmentedControlSize = "sm" | "md" | "lg";

export interface SegmentedControlOption<Value extends string> {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
  badge?: ReactNode;
  title?: string;
}

export interface SegmentedControlProps<Value extends string> {
  value: Value;
  options: readonly SegmentedControlOption<Value>[];
  onChange: (value: Value) => void;
  label: string;
  size?: SegmentedControlSize;
  fullWidth?: boolean;
  className?: string;
}

export const segmentedControlSizeClasses: Record<SegmentedControlSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-xs sm:text-sm",
  lg: "h-9.5 px-3.5 text-sm",
};

export function segmentedControlClassName({
  fullWidth = false,
  className = "",
}: {
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  const widthClass = fullWidth ? "flex w-full" : "inline-flex";
  return `${widthClass} max-w-full items-center overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-1 gap-1 ${className}`
    .trim()
    .replace(/\s+/g, " ");
}

export function segmentedControlItemClassName({
  active = false,
  disabled = false,
  size = "md",
  fullWidth = false,
}: {
  active?: boolean;
  disabled?: boolean;
  size?: SegmentedControlSize;
  fullWidth?: boolean;
} = {}): string {
  const sizeClass = segmentedControlSizeClasses[size] ?? segmentedControlSizeClasses.md;
  const base =
    "relative inline-flex items-center justify-center shrink-0 rounded-lg font-medium transition-all select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60";
  const stateClass = disabled
    ? "opacity-40 cursor-not-allowed pointer-events-none text-zinc-500"
    : active
      ? "bg-white/10 text-white shadow-sm font-medium"
      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]";
  const widthClass = fullWidth ? "flex-1 justify-center" : "";

  return `${base} ${sizeClass} ${stateClass} ${widthClass}`.trim().replace(/\s+/g, " ");
}

export function SegmentedControl<Value extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
  fullWidth = false,
  className,
}: SegmentedControlProps<Value>) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  const rovingIndex =
    selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : options.findIndex((option) => !option.disabled);

  function findEnabledIndex(index: number, direction: 1 | -1, includeStart = false): number {
    if (options.length === 0) return -1;
    const firstOffset = includeStart ? 0 : 1;
    for (let offset = firstOffset; offset <= options.length; offset += 1) {
      const candidate = (index + direction * offset + options.length) % options.length;
      if (!options[candidate]?.disabled) return candidate;
    }
    return -1;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? findEnabledIndex(0, 1, true)
        : event.key === "End"
          ? findEnabledIndex(options.length - 1, -1, true)
          : findEnabledIndex(index, event.key === "ArrowRight" ? 1 : -1);
    if (nextIndex < 0) return;
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const nextTab = tabs?.[nextIndex];
    nextTab?.focus();
    const option = options[nextIndex];
    if (option && !option.disabled) onChange(option.value);
  }

  return (
    <div
      className={segmentedControlClassName({ fullWidth, className })}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
    >
      {options.map((option, index) => {
        const active = value === option.value;
        const isDisabled = option.disabled;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={index === rovingIndex ? 0 : -1}
            disabled={isDisabled}
            title={option.title}
            onClick={() => !isDisabled && onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={segmentedControlItemClassName({
              active,
              disabled: isDisabled,
              size,
              fullWidth,
            })}
          >
            <span className="truncate">{option.label}</span>
            {option.badge ? (
              <span className="ml-1.5 inline-flex items-center rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
                {option.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export type SegmentedFieldDensity = "compact" | "normal";
export type SegmentedFieldColumns = "auto" | 1 | 2 | 3 | 4 | 5;

export interface SegmentedFieldOption<Value extends string> {
  value: Value;
  label: ReactNode;
  hint?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedFieldProps<Value extends string> {
  name?: string;
  legend?: ReactNode;
  label?: ReactNode;
  value: Value;
  options: readonly SegmentedFieldOption<Value>[];
  onChange: (value: Value) => void;
  description?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  columns?: SegmentedFieldColumns;
  density?: SegmentedFieldDensity;
  className?: string;
  disabled?: boolean;
}

export const segmentedFieldColumnsClasses: Record<SegmentedFieldColumns, string> = {
  auto: "grid-cols-2 sm:grid-flow-col sm:auto-cols-fr",
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-5",
};

export function segmentedFieldOptionClassName({
  active = false,
  disabled = false,
  density = "normal",
}: {
  active?: boolean;
  disabled?: boolean;
  density?: SegmentedFieldDensity;
} = {}): string {
  const densityClass =
    density === "compact"
      ? "min-h-8 px-2.5 py-1 text-xs"
      : "min-h-10 px-3.5 py-1.5 text-xs sm:text-sm";
  const base =
    "relative flex cursor-pointer items-center justify-center rounded-xl border text-center transition-all select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-400/60 has-[:focus-visible]:border-teal-400";
  const stateClass = disabled
    ? "opacity-40 cursor-not-allowed pointer-events-none border-white/10 bg-white/[0.03] text-zinc-500"
    : active
      ? "border-teal-400/80 bg-teal-500/20 text-teal-100 shadow-[0_0_12px_rgba(45,212,191,0.2)] font-medium"
      : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:bg-white/[0.07] hover:text-zinc-200";

  return `${base} ${densityClass} ${stateClass}`.trim().replace(/\s+/g, " ");
}

export function SegmentedField<Value extends string>({
  name,
  legend,
  label,
  value,
  options,
  onChange,
  description,
  hint,
  error,
  columns = "auto",
  density = "normal",
  className = "",
  disabled = false,
}: SegmentedFieldProps<Value>) {
  const titleText = legend ?? label;
  const descText = description ?? hint;
  const groupName =
    name ??
    (typeof titleText === "string" ? titleText : "segmented-field");
  const columnClass =
    segmentedFieldColumnsClasses[columns] ?? segmentedFieldColumnsClasses.auto;

  return (
    <fieldset className={`min-w-0 ${className}`.trim()} disabled={disabled}>
      {titleText ? (
        <legend className="text-xs font-medium text-zinc-300">{titleText}</legend>
      ) : null}
      {descText ? (
        <p className="mt-0.5 text-xs leading-5 text-zinc-500">{descText}</p>
      ) : null}
      <div className={`af-segmented-options mt-1.5 grid gap-1.5 ${columnClass}`}>
        {options.map((option) => {
          const active = value === option.value;
          const isDisabled = disabled || option.disabled;
          return (
            <label
              key={option.value}
              title={option.title}
              className={segmentedFieldOptionClassName({
                active,
                disabled: isDisabled,
                density,
              })}
            >
              <input
                type="radio"
                className="sr-only"
                name={groupName}
                value={option.value}
                checked={active}
                disabled={isDisabled}
                onChange={() => !isDisabled && onChange(option.value)}
              />
              <div className="flex flex-col items-center justify-center min-w-0">
                <div className="flex items-center justify-center gap-1.5 max-w-full">
                  <span className="truncate">{option.label}</span>
                  {option.badge ? (
                    <span className="inline-flex items-center rounded bg-teal-400/10 px-1.5 py-0.2 text-[10px] font-medium text-teal-300">
                      {option.badge}
                    </span>
                  ) : null}
                </div>
                {option.hint ? (
                  <span className="block text-[11px] text-zinc-500 font-normal">
                    {option.hint}
                  </span>
                ) : null}
              </div>
            </label>
          );
        })}
      </div>
      {error ? (
        <p className="mt-1 text-xs leading-5 text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
