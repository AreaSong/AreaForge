import type { ComponentPropsWithoutRef, ElementType } from "react";

type SurfaceTone = "subtle" | "default" | "raised";
type SurfacePadding = "none" | "sm" | "md";
type SurfaceElement = "article" | "aside" | "div" | "section";

const toneClass: Record<SurfaceTone, string> = {
  subtle: "bg-[var(--af-surface-subtle)]",
  default: "bg-[var(--af-surface)]",
  raised: "bg-[var(--af-surface-raised)]",
};

const paddingClass: Record<SurfacePadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-4 sm:p-5",
};

type SurfaceProps<T extends SurfaceElement = "div"> = {
  as?: T;
  tone?: SurfaceTone;
  padding?: SurfacePadding;
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
      className={`min-w-0 rounded-[var(--af-radius-surface)] border border-[var(--af-border)] ${toneClass[tone]} ${paddingClass[padding]} ${className ?? ""}`.trim()}
    />
  );
}

export function SectionSurface(props: Omit<SurfaceProps<"section">, "as">) {
  return <Surface as="section" {...props} />;
}
