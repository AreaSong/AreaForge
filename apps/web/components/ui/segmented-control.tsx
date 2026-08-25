import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface SegmentedControlOption<Value extends string> {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
}

export function SegmentedControl<Value extends string>(props: {
  value: Value;
  options: readonly SegmentedControlOption<Value>[];
  onChange: (value: Value) => void;
  label: string;
  className?: string;
}) {
  const selectedIndex = props.options.findIndex((option) => option.value === props.value);
  const rovingIndex = selectedIndex >= 0 && !props.options[selectedIndex]?.disabled
    ? selectedIndex
    : props.options.findIndex((option) => !option.disabled);

  function findEnabledIndex(index: number, direction: 1 | -1, includeStart = false): number {
    if (props.options.length === 0) return -1;
    const firstOffset = includeStart ? 0 : 1;
    for (let offset = firstOffset; offset <= props.options.length; offset += 1) {
      const candidate = (index + direction * offset + props.options.length) % props.options.length;
      if (!props.options[candidate]?.disabled) return candidate;
    }
    return -1;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? findEnabledIndex(0, 1, true)
      : event.key === "End"
        ? findEnabledIndex(props.options.length - 1, -1, true)
        : findEnabledIndex(index, event.key === "ArrowRight" ? 1 : -1);
    if (nextIndex < 0) return;
    const next = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex];
    next?.focus();
    const option = props.options[nextIndex];
    if (option && !option.disabled) props.onChange(option.value);
  }

  return (
    <div className={`inline-flex max-w-full overflow-x-auto rounded-md border border-white/10 p-1 ${props.className ?? ""}`.trim()} role="tablist" aria-label={props.label} aria-orientation="horizontal">
      {props.options.map((option, index) => (
        <Button
          key={option.value}
          type="button"
          variant="ghost"
          size="sm"
          role="tab"
          aria-selected={props.value === option.value}
          tabIndex={index === rovingIndex ? 0 : -1}
          disabled={option.disabled}
          onClick={() => props.onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={`shrink-0 rounded px-3 text-sm ${props.value === option.value ? "bg-white/10 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
