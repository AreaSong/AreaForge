import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variantClass: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-teal-400 text-[#071011] shadow-[0_0_12px_rgba(45,212,191,0.3)] hover:bg-teal-300 hover:shadow-[0_0_16px_rgba(45,212,191,0.5)] active:scale-[0.98]",
  secondary: "border-white/15 bg-white/[0.04] text-zinc-100 hover:border-white/25 hover:bg-white/[0.08] active:scale-[0.98]",
  ghost: "border-transparent bg-transparent text-zinc-300 hover:bg-white/[0.06] hover:text-white active:scale-[0.98]",
  danger: "border-red-400/35 bg-red-500/10 text-red-200 hover:bg-red-500/20 active:scale-[0.98]",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-xs",
  md: "h-10 px-3.5 text-sm",
  lg: "h-11 px-4 text-sm",
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

export function Button({
  variant,
  size,
  loading = false,
  loadingLabel = "处理中",
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={buttonClassName({ variant, size, className })}
    >
      {loading ? <Spinner /> : null}
      {loading ? loadingLabel : children}
    </button>
  );
}

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

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />;
}
