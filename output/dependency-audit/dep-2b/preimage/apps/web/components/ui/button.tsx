import Link from "next/link";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import {
  Button,
  ButtonSpinner,
  buttonClassName,
  buttonSizeClasses,
  buttonVariantClasses,
  baseButtonClasses,
  iconButtonClassName,
  iconButtonSizeClasses,
  IconButton,
  type ButtonProps,
  type IconButtonProps,
  type ButtonVariant,
  type ButtonSize,
  type ButtonClassNameOptions,
  type IconButtonClassNameOptions,
} from "@areaforge/ui";

export {
  Button,
  ButtonSpinner,
  buttonClassName,
  buttonSizeClasses,
  buttonVariantClasses,
  baseButtonClasses,
  iconButtonClassName,
  iconButtonSizeClasses,
  IconButton,
  type ButtonProps,
  type IconButtonProps,
  type ButtonVariant,
  type ButtonSize,
  type ButtonClassNameOptions,
  type IconButtonClassNameOptions,
};

export type ButtonLinkProps = Omit<
  ComponentPropsWithoutRef<typeof Link>,
  "className"
> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
  ariaLabel?: string;
  children?: ReactNode;
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
      <Link
        {...props}
        ref={ref}
        aria-label={directAriaLabel ?? ariaLabel}
        className={buttonClassName({ variant, size, fullWidth, className })}
      >
        {children}
      </Link>
    );
  },
);

ButtonLink.displayName = "ButtonLink";
