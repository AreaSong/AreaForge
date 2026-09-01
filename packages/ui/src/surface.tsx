import React, { type ComponentPropsWithoutRef, type ElementType } from "react";

export type SurfaceTone = "subtle" | "default" | "raised" | "card" | "canvas";
export type SurfacePadding = "none" | "sm" | "md" | "lg";
export type SurfaceElement = "article" | "aside" | "div" | "footer" | "header" | "section";

export const surfaceToneClasses: Record<SurfaceTone, string> = {
  subtle: "bg-[var(--af-surface-subtle)]",
  default: "bg-[var(--af-surface)]",
  raised: "bg-[var(--af-surface-raised)]",
  card: "bg-[var(--af-surface-card)]",
  canvas: "bg-[var(--af-canvas)]",
};

export const surfacePaddingClasses: Record<SurfacePadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-4 sm:p-5",
  lg: "p-5 sm:p-6 lg:p-8",
};

export interface SurfaceClassNameOptions {
  tone?: SurfaceTone;
  padding?: SurfacePadding;
  className?: string;
}

export function surfaceClassName({
  tone = "default",
  padding = "md",
  className,
}: SurfaceClassNameOptions = {}): string {
  const baseTone = surfaceToneClasses[tone] ?? surfaceToneClasses.default;
  const basePadding = surfacePaddingClasses[padding] ?? surfacePaddingClasses.md;
  return `min-w-0 rounded-[var(--af-radius-surface)] border border-[var(--af-border)] ${baseTone} ${basePadding} ${className ?? ""}`.trim().replace(/\s+/g, " ");
}

export type SurfaceProps<T extends SurfaceElement = "div"> = {
  as?: T;
  tone?: SurfaceTone;
  padding?: SurfacePadding;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as">;

export function Surface<T extends SurfaceElement = "div">({
  as,
  tone = "default",
  padding = "md",
  className,
  ...props
}: SurfaceProps<T>) {
  const Component = (as ?? "div") as ElementType;
  return (
    <Component
      {...props}
      className={surfaceClassName({ tone, padding, className })}
    />
  );
}

export function SectionSurface(props: Omit<SurfaceProps<"section">, "as">) {
  return <Surface as="section" {...props} />;
}

export function ArticleSurface(props: Omit<SurfaceProps<"article">, "as">) {
  return <Surface as="article" {...props} />;
}

export function AsideSurface(props: Omit<SurfaceProps<"aside">, "as">) {
  return <Surface as="aside" {...props} />;
}
