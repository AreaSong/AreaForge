import React, { type ComponentPropsWithoutRef, type ElementType } from "react";

export type CardVariant = "master" | "subtle" | "accent";
export type CardPadding = "none" | "sm" | "md" | "lg";
export type CardElement = "article" | "aside" | "div" | "footer" | "header" | "section";

export const cardVariantClasses: Record<CardVariant, string> = {
  master: "rounded-2xl border border-white/10 bg-[#0e1619]/90 shadow-lg",
  subtle: "rounded-xl border border-white/5 bg-white/[0.02]",
  accent: "rounded-2xl border border-teal-500/20 bg-[#0e1619]/90 shadow-[0_0_16px_rgba(45,212,191,0.15)]",
};

export const cardPaddingClasses: Record<CardPadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4 sm:p-5",
  lg: "p-5 sm:p-6",
};

export interface CardClassNameOptions {
  variant?: CardVariant;
  padding?: CardPadding;
  className?: string;
}

export function cardClassName({
  variant = "master",
  padding = "md",
  className,
}: CardClassNameOptions = {}): string {
  const baseVariant = cardVariantClasses[variant] ?? cardVariantClasses.master;
  const basePadding = cardPaddingClasses[padding] ?? cardPaddingClasses.md;
  return `min-w-0 ${baseVariant} ${basePadding} ${className ?? ""}`.trim().replace(/\s+/g, " ");
}

export type CardProps<T extends CardElement = "div"> = {
  as?: T;
  variant?: CardVariant;
  padding?: CardPadding;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as">;

export function Card<T extends CardElement = "div">({
  as,
  variant = "master",
  padding = "md",
  className,
  ...props
}: CardProps<T>) {
  const Component = (as ?? "div") as ElementType;
  return (
    <Component
      {...props}
      className={cardClassName({ variant, padding, className })}
    />
  );
}

export function SectionCard(props: Omit<CardProps<"section">, "as">) {
  return <Card as="section" {...props} />;
}

export function ArticleCard(props: Omit<CardProps<"article">, "as">) {
  return <Card as="article" {...props} />;
}

export function AsideCard(props: Omit<CardProps<"aside">, "as">) {
  return <Card as="aside" {...props} />;
}

export function CardHeader({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={`flex flex-col space-y-1.5 ${className ?? ""}`.trim().replace(/\s+/g, " ")}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<"h3">) {
  return (
    <h3
      className={`text-base font-semibold leading-none tracking-tight text-white ${className ?? ""}`.trim().replace(/\s+/g, " ")}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      className={`text-xs text-zinc-400 ${className ?? ""}`.trim().replace(/\s+/g, " ")}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={`pt-0 ${className ?? ""}`.trim().replace(/\s+/g, " ")}
      {...props}
    />
  );
}

export function CardFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={`flex items-center pt-3 ${className ?? ""}`.trim().replace(/\s+/g, " ")}
      {...props}
    />
  );
}
