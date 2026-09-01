import React, {
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
} from "react";
import { Button, type ButtonVariant } from "./button";

export type PinnedActionBarMode = "sticky" | "docked" | "inline";
export type PinnedActionBarPadding = "none" | "sm" | "md" | "lg";
export type PinnedActionBarElement =
  | "footer"
  | "div"
  | "nav"
  | "section"
  | "header";

export const pinnedActionBarModeClasses: Record<PinnedActionBarMode, string> = {
  sticky:
    "sticky bottom-0 z-10 w-full border-t border-white/10 bg-[#080b0f]/90 backdrop-blur-md shadow-[0_-4px_16px_rgba(0,0,0,0.4)]",
  docked:
    "fixed bottom-0 left-0 right-0 z-20 border-t border-white/10 bg-[#080b0f]/95 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.5)]",
  inline: "relative w-full border-t border-white/10 bg-transparent",
};

export const pinnedActionBarPaddingClasses: Record<
  PinnedActionBarPadding,
  string
> = {
  none: "",
  sm: "px-3 py-2 sm:px-4",
  md: "px-4 py-3 sm:px-6",
  lg: "px-6 py-4 sm:px-8",
};

export interface PinnedActionBarClassNameOptions {
  mode?: PinnedActionBarMode;
  padding?: PinnedActionBarPadding;
  className?: string;
}

export function pinnedActionBarClassName({
  mode = "sticky",
  padding = "md",
  className = "",
}: PinnedActionBarClassNameOptions = {}): string {
  const baseMode =
    pinnedActionBarModeClasses[mode] ?? pinnedActionBarModeClasses.sticky;
  const basePadding =
    pinnedActionBarPaddingClasses[padding] ??
    pinnedActionBarPaddingClasses.md;
  return `min-w-0 transition-all ${baseMode} ${basePadding} ${className}`
    .trim()
    .replace(/\s+/g, " ");
}

export type PinnedActionBarProps<
  T extends PinnedActionBarElement = "footer",
> = {
  as?: T;
  mode?: PinnedActionBarMode;
  padding?: PinnedActionBarPadding;
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  status?: ReactNode;
  children?: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children">;

export function PinnedActionBar<T extends PinnedActionBarElement = "footer">({
  as,
  mode = "sticky",
  padding = "md",
  left,
  center,
  right,
  status,
  children,
  className,
  ...props
}: PinnedActionBarProps<T>) {
  const Component = (as ?? "footer") as ElementType;
  const resolvedLeft = left ?? status;
  const hasSlots = Boolean(resolvedLeft || center || right);

  return (
    <Component
      {...props}
      className={pinnedActionBarClassName({ mode, padding, className })}
      data-pinned-action-bar="true"
      data-pinned-mode={mode}
    >
      {hasSlots ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex items-center gap-3 text-xs leading-5 text-zinc-400">
            {resolvedLeft}
          </div>
          {center ? (
            <div className="min-w-0 flex items-center justify-center gap-2 text-xs text-zinc-400 sm:flex-1">
              {center}
            </div>
          ) : null}
          <div className="flex w-full flex-col-reverse items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
            {right}
          </div>
        </div>
      ) : (
        children
      )}
    </Component>
  );
}

export interface EditorActionBarProps {
  // Primary Action
  primaryLabel: string;
  primaryIcon?: ReactNode;
  primaryType?: "button" | "submit";
  primaryDisabled?: boolean;
  primaryVariant?: ButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
  onPrimary?: () => void;

  // Secondary Action
  secondaryLabel?: string;
  secondaryIcon?: ReactNode;
  secondaryDisabled?: boolean;
  secondaryVariant?: ButtonVariant;
  onSecondary?: () => void;

  // Status & Hints
  hint?: ReactNode;
  status?: ReactNode;
  error?: ReactNode;

  // Additional actions & Layout
  extraActions?: ReactNode;
  mode?: PinnedActionBarMode;
  padding?: PinnedActionBarPadding;
  className?: string;
  children?: ReactNode;
}

export function EditorActionBar(props: EditorActionBarProps) {
  const {
    primaryLabel,
    primaryIcon,
    primaryType = "button",
    primaryDisabled = false,
    primaryVariant = "primary",
    loading = false,
    loadingLabel = "正在保存到服务端",
    onPrimary,
    secondaryLabel,
    secondaryIcon,
    secondaryDisabled = false,
    secondaryVariant = "secondary",
    onSecondary,
    hint,
    status,
    error,
    extraActions,
    mode = "sticky",
    padding = "md",
    className,
    children,
  } = props;

  const leftContent = (
    <div className="flex flex-col gap-0.5 min-w-0">
      {status ? <div className="min-w-0">{status}</div> : null}
      {hint ? (
        <div className="min-w-0 text-xs leading-5 text-zinc-500">{hint}</div>
      ) : null}
      {error ? (
        <div className="min-w-0 text-xs leading-5 text-rose-400">{error}</div>
      ) : null}
    </div>
  );

  const rightContent = (
    <>
      {extraActions}
      {secondaryLabel && onSecondary ? (
        <Button
          type="button"
          variant={secondaryVariant}
          size="lg"
          className="w-full sm:w-auto"
          disabled={secondaryDisabled || loading}
          onClick={onSecondary}
        >
          {secondaryIcon}
          {secondaryLabel}
        </Button>
      ) : null}
      <Button
        type={primaryType}
        variant={primaryVariant}
        size="lg"
        className="w-full sm:w-auto"
        disabled={primaryDisabled}
        loading={loading}
        loadingLabel={loadingLabel}
        onClick={onPrimary}
      >
        {primaryIcon}
        {primaryLabel}
      </Button>
    </>
  );

  return (
    <PinnedActionBar
      mode={mode}
      padding={padding}
      className={className}
      left={leftContent}
      right={rightContent}
    >
      {children}
    </PinnedActionBar>
  );
}
