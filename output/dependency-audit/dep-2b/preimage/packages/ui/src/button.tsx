import React, {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "outline"
  | "subtle";

export type ButtonSize = "sm" | "md" | "lg" | "xl";

export const baseButtonClasses =
  "inline-flex shrink-0 items-center justify-center rounded-xl border font-medium select-none transition-all duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#080b0f] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

export const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-teal-400 text-[#061012] shadow-[0_0_20px_rgba(45,212,191,0.35)] hover:bg-teal-300 hover:shadow-[0_0_28px_rgba(45,212,191,0.5)] active:scale-[0.98] font-semibold",
  secondary:
    "border-white/10 bg-white/5 text-zinc-300 hover:border-white/20 hover:bg-white/10 hover:text-white active:scale-[0.98] font-medium",
  ghost:
    "border-transparent bg-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200 active:scale-[0.98] font-medium",
  danger:
    "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 active:scale-[0.98] font-medium",
  outline:
    "border-white/20 bg-transparent text-zinc-200 hover:border-white/40 hover:bg-white/5 hover:text-white active:scale-[0.98] font-medium",
  subtle:
    "border-white/5 bg-white/[0.02] text-zinc-300 hover:border-white/10 hover:bg-white/5 hover:text-zinc-100 active:scale-[0.98] font-medium",
};

export const buttonSizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
  xl: "h-12 px-6 text-base gap-2.5",
};

export const iconButtonSizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 w-8 text-xs p-0",
  md: "h-10 w-10 text-sm p-0",
  lg: "h-11 w-11 text-sm p-0",
  xl: "h-12 w-12 text-base p-0",
};

export interface ButtonClassNameOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

export function buttonClassName(
  input: ButtonClassNameOptions | string = {},
): string {
  if (typeof input === "string") {
    return `${baseButtonClasses} ${buttonVariantClasses.secondary} ${buttonSizeClasses.md} ${input}`
      .trim()
      .replace(/\s+/g, " ");
  }
  const {
    variant = "secondary",
    size = "md",
    fullWidth = false,
    className = "",
  } = input;
  const variantClass =
    buttonVariantClasses[variant] ?? buttonVariantClasses.secondary;
  const sizeClass = buttonSizeClasses[size] ?? buttonSizeClasses.md;
  const widthClass = fullWidth ? "w-full" : "";
  return `${baseButtonClasses} ${variantClass} ${sizeClass} ${widthClass} ${className}`
    .trim()
    .replace(/\s+/g, " ");
}

export interface IconButtonClassNameOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

export function iconButtonClassName(
  input: IconButtonClassNameOptions | string = {},
): string {
  if (typeof input === "string") {
    return `${baseButtonClasses} ${buttonVariantClasses.ghost} ${iconButtonSizeClasses.md} aspect-square shrink-0 !px-0 ${input}`
      .trim()
      .replace(/\s+/g, " ");
  }
  const { variant = "ghost", size = "md", className = "" } = input;
  const variantClass =
    buttonVariantClasses[variant] ?? buttonVariantClasses.ghost;
  const sizeClass = iconButtonSizeClasses[size] ?? iconButtonSizeClasses.md;
  return `${baseButtonClasses} ${variantClass} ${sizeClass} aspect-square shrink-0 !px-0 ${className}`
    .trim()
    .replace(/\s+/g, " ");
}

export function ButtonSpinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent shrink-0 ${className}`.trim()}
      aria-hidden="true"
    />
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    loadingLabel = "处理中",
    leftIcon,
    rightIcon,
    fullWidth = false,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading ? "true" : undefined}
      className={buttonClassName({ variant, size, fullWidth, className })}
    >
      {loading ? (
        <ButtonSpinner />
      ) : leftIcon ? (
        <span className="inline-flex shrink-0 items-center">{leftIcon}</span>
      ) : null}
      {loading ? <span>{loadingLabel}</span> : children}
      {!loading && rightIcon ? (
        <span className="inline-flex shrink-0 items-center">{rightIcon}</span>
      ) : null}
    </button>
  );
});

Button.displayName = "Button";

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label"
> & {
  label: string;
  title?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  "aria-label"?: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      title = label,
      variant = "ghost",
      size = "md",
      loading = false,
      className,
      children,
      disabled,
      type = "button",
      "aria-label": ariaLabel,
      ...props
    },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-label={ariaLabel ?? label}
        aria-busy={loading ? "true" : undefined}
        title={title}
        className={iconButtonClassName({
          variant,
          size,
          className,
        })}
      >
        {loading ? <ButtonSpinner /> : children}
      </button>
    );
  },
);

IconButton.displayName = "IconButton";

export type ButtonLinkProps = ComponentPropsWithoutRef<"a"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  ariaLabel?: string;
};

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  function ButtonLink(
    {
      variant = "secondary",
      size = "md",
      fullWidth = false,
      className,
      ariaLabel,
      "aria-label": directAriaLabel,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <a
        {...props}
        ref={ref}
        aria-label={directAriaLabel ?? ariaLabel}
        className={buttonClassName({ variant, size, fullWidth, className })}
      >
        {children}
      </a>
    );
  },
);

ButtonLink.displayName = "ButtonLink";
