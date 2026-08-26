import assert from "node:assert/strict";
import test from "node:test";
import {
  areaForgeTokens,
  colors,
  heights,
  layers,
  radii,
  shadows,
  transitions,
} from "@areaforge/ui";
import {
  ArticleCard,
  AsideCard,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  SectionCard,
  cardClassName,
  cardPaddingClasses,
  cardVariantClasses,
} from "./card";
import {
  ArticleSurface,
  AsideSurface,
  SectionSurface,
  Surface,
  surfaceClassName,
  surfacePaddingClasses,
  surfaceToneClasses,
} from "./surface";

test("Design Tokens: color tokens match the /focus dark glass workstation standard", () => {
  assert.equal(colors.canvas, "#080b0f");
  assert.equal(colors.surface.card, "#0e1619");
  assert.equal(colors.surface.cardAlpha, "rgba(14, 22, 25, 0.90)");
  assert.equal(colors.surface.subtle, "rgba(255, 255, 255, 0.02)");
  assert.equal(colors.surface.base, "#101419");
  assert.equal(colors.surface.raised, "#151a20");
  assert.equal(colors.border.default, "rgba(255, 255, 255, 0.10)");
  assert.equal(colors.border.subtle, "rgba(255, 255, 255, 0.05)");
  assert.equal(colors.accent.primary, "#2dd4bf");
  assert.equal(colors.accent.hover, "#5eead4");
  assert.equal(colors.accent.strong, "#14b8a6");
});

test("Design Tokens: radii, shadows, and heights conform to ergonomic scales", () => {
  assert.equal(radii.control, "0.75rem");
  assert.equal(radii.card, "1rem");
  assert.equal(radii.surface, "1rem");
  assert.equal(shadows.tealGlow, "0 0 20px rgba(45, 212, 191, 0.35)");
  assert.equal(shadows.tealGlowHover, "0 0 28px rgba(45, 212, 191, 0.50)");
  assert.equal(heights.controlSm, "2.25rem");
  assert.equal(heights.controlMd, "2.5rem");
  assert.equal(heights.controlLg, "2.75rem");
  assert.equal(heights.controlXl, "3rem");
  assert.equal(layers.modal, 120);
  assert.equal(transitions.scaleActive, "scale(0.98)");
});

test("Design Tokens: legacy areaForgeTokens backward compatibility is preserved", () => {
  assert.equal(areaForgeTokens.radius.sm, "6px");
  assert.equal(areaForgeTokens.radius.md, "8px");
  assert.equal(areaForgeTokens.accent.forge, "#14b8a6");
  assert.equal(areaForgeTokens.accent.warning, "#f59e0b");
  assert.equal(areaForgeTokens.accent.danger, "#ef4444");
  assert.equal(areaForgeTokens.accent.progress, "#38bdf8");
  assert.equal(areaForgeTokens.colors.canvas, "#080b0f");
});

test("cardClassName and dictionary records: generate expected classes for all variants and paddings", () => {
  assert.ok(cardVariantClasses.master.includes("rounded-2xl"));
  assert.ok(cardVariantClasses.subtle.includes("rounded-xl"));
  assert.ok(cardVariantClasses.accent.includes("shadow-[0_0_16px_rgba(45,212,191,0.15)]"));
  assert.equal(cardPaddingClasses.none, "");
  assert.equal(cardPaddingClasses.sm, "p-3 sm:p-4");
  assert.equal(cardPaddingClasses.md, "p-4 sm:p-5");
  assert.equal(cardPaddingClasses.lg, "p-5 sm:p-6 lg:p-8");

  // Default master variant + md padding
  const defaultClass = cardClassName();
  assert.ok(defaultClass.includes("rounded-2xl"));
  assert.ok(defaultClass.includes("bg-[#0e1619]/90"));
  assert.ok(defaultClass.includes("border-white/10"));
  assert.ok(defaultClass.includes("shadow-lg"));
  assert.ok(defaultClass.includes("p-4 sm:p-5"));

  // Subtle variant
  const subtleClass = cardClassName({ variant: "subtle" });
  assert.ok(subtleClass.includes("rounded-xl"));
  assert.ok(subtleClass.includes("border-white/5"));
  assert.ok(subtleClass.includes("bg-white/[0.02]"));

  // Accent variant
  const accentClass = cardClassName({ variant: "accent" });
  assert.ok(accentClass.includes("rounded-2xl"));
  assert.ok(accentClass.includes("border-teal-500/20"));
  assert.ok(accentClass.includes("shadow-[0_0_16px_rgba(45,212,191,0.15)]"));

  // Padding variations
  assert.ok(cardClassName({ padding: "none" }).endsWith("shadow-lg"));
  assert.ok(cardClassName({ padding: "sm" }).includes("p-3 sm:p-4"));
  assert.ok(cardClassName({ padding: "lg" }).includes("p-5 sm:p-6 lg:p-8"));

  // Custom class concatenation
  const custom = cardClassName({ variant: "master", className: "extra-class" });
  assert.ok(custom.endsWith("extra-class"));
});

test("surfaceClassName and dictionary records: generate expected classes and preserve backward compatibility", () => {
  assert.equal(surfaceToneClasses.default, "bg-[var(--af-surface)]");
  assert.equal(surfaceToneClasses.subtle, "bg-[var(--af-surface-subtle)]");
  assert.equal(surfaceToneClasses.raised, "bg-[var(--af-surface-raised)]");
  assert.equal(surfaceToneClasses.card, "bg-[var(--af-surface-card)]");
  assert.equal(surfaceToneClasses.canvas, "bg-[var(--af-canvas)]");
  assert.equal(surfacePaddingClasses.none, "");
  assert.equal(surfacePaddingClasses.sm, "p-4");
  assert.equal(surfacePaddingClasses.md, "p-4 sm:p-5");
  assert.equal(surfacePaddingClasses.lg, "p-5 sm:p-6 lg:p-8");

  // Default tone + md padding
  const defaultClass = surfaceClassName();
  assert.ok(defaultClass.includes("rounded-[var(--af-radius-surface)]"));
  assert.ok(defaultClass.includes("border-[var(--af-border)]"));
  assert.ok(defaultClass.includes("bg-[var(--af-surface)]"));
  assert.ok(defaultClass.includes("p-4 sm:p-5"));

  // Tones
  assert.ok(surfaceClassName({ tone: "subtle" }).includes("bg-[var(--af-surface-subtle)]"));
  assert.ok(surfaceClassName({ tone: "raised" }).includes("bg-[var(--af-surface-raised)]"));
  assert.ok(surfaceClassName({ tone: "card" }).includes("bg-[var(--af-surface-card)]"));
  assert.ok(surfaceClassName({ tone: "canvas" }).includes("bg-[var(--af-canvas)]"));

  // Paddings
  assert.ok(surfaceClassName({ padding: "sm" }).includes("p-4"));
  assert.ok(surfaceClassName({ padding: "lg" }).includes("p-5 sm:p-6 lg:p-8"));
});

test("Card & Surface React Primitives: component elements and subcomponents render valid JSX structures", () => {
  // Card
  const cardElem = Card({
    children: "Content",
    variant: "master",
    padding: "md",
    className: "test-card",
  });
  assert.equal(cardElem.type, "div");
  assert.ok(cardElem.props.className.includes("test-card"));
  assert.equal(cardElem.props.children, "Content");

  // SectionCard
  const sectionCardElem = SectionCard({ children: "Section" });
  assert.equal(sectionCardElem.type, Card);
  assert.equal(sectionCardElem.props.as, "section");

  // ArticleCard
  const articleCardElem = ArticleCard({ children: "Article" });
  assert.equal(articleCardElem.type, Card);
  assert.equal(articleCardElem.props.as, "article");

  // AsideCard
  const asideCardElem = AsideCard({ children: "Aside" });
  assert.equal(asideCardElem.type, Card);
  assert.equal(asideCardElem.props.as, "aside");

  // Card Subcomponents
  const headerElem = CardHeader({ children: "Header" });
  assert.equal(headerElem.type, "div");
  assert.ok(headerElem.props.className.includes("space-y-1.5"));

  const titleElem = CardTitle({ children: "Title" });
  assert.equal(titleElem.type, "h3");
  assert.ok(titleElem.props.className.includes("text-base font-semibold"));

  const descElem = CardDescription({ children: "Description" });
  assert.equal(descElem.type, "p");
  assert.ok(descElem.props.className.includes("text-xs text-zinc-400"));

  const contentElem = CardContent({ children: "Body" });
  assert.equal(contentElem.type, "div");
  assert.ok(contentElem.props.className.includes("pt-0"));

  const footerElem = CardFooter({ children: "Footer" });
  assert.equal(footerElem.type, "div");
  assert.ok(footerElem.props.className.includes("pt-3"));

  // Surface
  const surfaceElem = Surface({
    children: "Surface Content",
    tone: "raised",
    padding: "sm",
  });
  assert.equal(surfaceElem.type, "div");
  assert.ok(surfaceElem.props.className.includes("bg-[var(--af-surface-raised)]"));

  // SectionSurface
  const sectionSurfaceElem = SectionSurface({ children: "Section Surface" });
  assert.equal(sectionSurfaceElem.type, Surface);
  assert.equal(sectionSurfaceElem.props.as, "section");

  // ArticleSurface & AsideSurface
  const articleSurfaceElem = ArticleSurface({ children: "Article Surface" });
  assert.equal(articleSurfaceElem.type, Surface);
  assert.equal(articleSurfaceElem.props.as, "article");

  const asideSurfaceElem = AsideSurface({ children: "Aside Surface" });
  assert.equal(asideSurfaceElem.type, Surface);
  assert.equal(asideSurfaceElem.props.as, "aside");
});
