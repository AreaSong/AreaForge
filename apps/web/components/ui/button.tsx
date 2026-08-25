import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variantClass: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-teal-400 text-[#071011] shadow-[0_0_12px_rgba(45,212,191,0.3)] hover:bg-teal-300 hover:shadow-[0_0_16px_rgba(45,212,191,0.5)] active:scale-[0.98]",
  secondary: "border-white/15 bg-white/[0.04] text-zinc-100 hover:border-white/25 hover:bg-white/[0.08] active:scale-[0.98]",
  ghost: "border-transparent bg-transparent text-zinc-300 hover:bg-white/[0.06] hover:text-white active:scale-[0.98]",
  danger: "border-red-400/35 bg-red-500/10 text-red-200 hover:bg-red-500/20 active:scale-[0.98]",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "af-control-height-sm px-3 text-xs",
  md: "af-control-height-md px-3.5 text-sm",
  lg: "af-control-height-lg px-4 text-sm",
};

export function buttonClassName(input: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  const { variant = "secondary", size = "md", className = "" } = input;
  return [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-medium transition-all duration-200 ease-out",
    "disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    variantClass[variant],
    sizeClass[size],
    className,
  ].filter(Boolean).join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant,
  size,
  loading = false,
  loadingLabel = "处理中",
  className,
  children,
  disabled,
  ...props
}, ref) {
  return (
    <button
      {...props}
      ref={ref}
      disabled={disabled || loading}
      className={buttonClassName({ variant, size, className })}
    >
      {loading ? <Spinner /> : null}
      {loading ? loadingLabel : children}
    </button>
  );
});

export function ButtonLink(props: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={props.href}
      aria-label={props.ariaLabel}
      className={buttonClassName({ variant: props.variant, size: props.size, className: props.className })}
    >
      {props.children}
    </Link>
  );
}

/**
 * Stable square command surface for familiar icon-only actions.
 * The visible label remains available to assistive technology and as a tooltip.
 */
export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  title?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label,
  title = label,
  variant = "ghost",
  size = "md",
  className,
  children,
  "aria-label": ariaLabel,
  ...props
}, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={props.type ?? "button"}
      aria-label={ariaLabel ?? label}
      title={title}
      className={buttonClassName({
        variant,
        size,
        className: `aspect-square !px-0 ${className ?? ""}`,
      })}
    >
      {children}
    </button>
  );
});

IconButton.displayName = "IconButton";

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />;
}
