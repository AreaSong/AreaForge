import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import {
  areaForgeTokens,
} from "@areaforge/ui";
import {
  SectionSurface,
  Surface,
  surfaceClassName,
} from "./surface";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardClassName,
} from "./card";

// ============================================================================
// SUITE 1: Target Workbenches Exact Usage Replication
// ============================================================================

test("Workbench Compatibility: settings-workbench.tsx Surface usages", () => {
  // Usage 1: <SectionSurface> wrapper
  const section1 = SectionSurface({
    children: React.createElement("div", null, "Account Settings"),
  });
  assert.equal(section1.type, Surface);
  assert.equal(section1.props.as, "section");
  const renderedSection1 = Surface(section1.props);
  assert.equal(renderedSection1.type, "section");
  assert.ok(renderedSection1.props.className.includes("rounded-[var(--af-radius-surface)]"));
  assert.ok(renderedSection1.props.className.includes("bg-[var(--af-surface)]"));
  assert.ok(renderedSection1.props.className.includes("p-4 sm:p-5"));

  // Usage 2: <Surface tone="raised" padding="sm" className="mt-5 text-sm">
  const lastOpSurface = Surface({
    tone: "raised",
    padding: "sm",
    className: "mt-5 text-sm",
    children: React.createElement("p", null, "Operation message"),
  });
  assert.equal(lastOpSurface.type, "div");
  assert.ok(lastOpSurface.props.className.includes("bg-[var(--af-surface-raised)]"));
  assert.ok(lastOpSurface.props.className.includes("p-4"));
  assert.ok(lastOpSurface.props.className.includes("mt-5 text-sm"));
  assert.ok(!lastOpSurface.props.className.includes("p-4 sm:p-5"), "sm padding should override default md padding");
});

test("Workbench Compatibility: simulation-workbench-*.tsx Surface usages", () => {
  // Usage 1: <SectionSurface> in SimulationExamSection
  const examSection = SectionSurface({
    children: React.createElement("h2", null, "创建结构化模拟考试"),
  });
  assert.equal(examSection.type, Surface);
  assert.equal(examSection.props.as, "section");

  // Usage 2: <Surface as="article" key={exam.id} tone="raised" padding="sm">
  const examArticle = Surface({
    as: "article",
    tone: "raised",
    padding: "sm",
    children: React.createElement("h3", null, "Exam Title"),
  });
  assert.equal(examArticle.type, "article");
  assert.ok(examArticle.props.className.includes("bg-[var(--af-surface-raised)]"));
  assert.ok(examArticle.props.className.includes("p-4"));

  // Usage 3: <Surface as="article" key={plan.id} tone="raised" padding="sm">
  const planArticle = Surface({
    as: "article",
    tone: "raised",
    padding: "sm",
    children: React.createElement("div", null, "Plan Goal"),
  });
  assert.equal(planArticle.type, "article");
  assert.ok(planArticle.props.className.includes("border-[var(--af-border)]"));

  // Usage 4: <Surface as="article" key={draft.id} tone="raised" padding="sm">
  const draftArticle = Surface({
    as: "article",
    tone: "raised",
    padding: "sm",
    children: React.createElement("div", null, "Draft Risk"),
  });
  assert.equal(draftArticle.type, "article");
  assert.ok(draftArticle.props.className.includes("min-w-0"));
});

test("Workbench Compatibility: mistake-library.tsx SectionSurface usages", () => {
  // Usage: <SectionSurface> enclosing toolbar, metrics, and list
  const mistakeSection = SectionSurface({
    children: [
      React.createElement("div", { key: "toolbar" }, "Toolbar"),
      React.createElement("dl", { key: "metrics" }, "Metrics"),
      React.createElement("div", { key: "list" }, "List"),
    ],
  });
  assert.equal(mistakeSection.type, Surface);
  assert.equal(mistakeSection.props.as, "section");
  const rendered = Surface(mistakeSection.props);
  assert.equal(rendered.type, "section");
  assert.equal(React.Children.count(rendered.props.children), 3);
});

// ============================================================================
// SUITE 2: Design Tokens & CSS Variable Invariants
// ============================================================================

test("Token Invariants: areaForgeTokens legacy bridge matches exact historical contracts", () => {
  // Legacy radius contracts
  assert.equal(areaForgeTokens.radius.sm, "6px");
  assert.equal(areaForgeTokens.radius.md, "8px");
  assert.equal(areaForgeTokens.radius.control, "0.75rem");
  assert.equal(areaForgeTokens.radius.card, "1rem");
  assert.equal(areaForgeTokens.radius.surface, "1rem");

  // Legacy accent contracts
  assert.equal(areaForgeTokens.accent.forge, "#14b8a6");
  assert.equal(areaForgeTokens.accent.warning, "#f59e0b");
  assert.equal(areaForgeTokens.accent.danger, "#ef4444");
  assert.equal(areaForgeTokens.accent.progress, "#38bdf8");

  // Core colors
  assert.equal(areaForgeTokens.colors.canvas, "#080b0f");
  assert.equal(areaForgeTokens.colors.surface.card, "#0e1619");
  assert.equal(areaForgeTokens.colors.surface.subtle, "rgba(255, 255, 255, 0.02)");
  assert.equal(areaForgeTokens.colors.surface.raised, "#151a20");
  assert.equal(areaForgeTokens.colors.surface.cardAlpha, "rgba(14, 22, 25, 0.90)");

  // Shadows
  assert.equal(areaForgeTokens.shadows.tealGlow, "0 0 20px rgba(45, 212, 191, 0.35)");
  assert.equal(areaForgeTokens.shadows.tealGlowHover, "0 0 28px rgba(45, 212, 191, 0.50)");

  // Heights
  assert.equal(areaForgeTokens.heights.controlSm, "2.25rem");
  assert.equal(areaForgeTokens.heights.controlMd, "2.5rem");
  assert.equal(areaForgeTokens.heights.controlLg, "2.75rem");
  assert.equal(areaForgeTokens.heights.controlXl, "3rem");

  // Layers & Transitions
  assert.equal(areaForgeTokens.layers.workspaceWindow, 100);
  assert.equal(areaForgeTokens.layers.modal, 120);
  assert.equal(areaForgeTokens.transitions.scaleActive, "scale(0.98)");
});

// ============================================================================
// SUITE 3: Surface & Card Helper Function Boundary Stress Tests
// ============================================================================

test("surfaceClassName: boundary and fallback robustness", () => {
  // Undefined options defaults to default tone and md padding
  assert.equal(
    surfaceClassName(),
    "min-w-0 rounded-[var(--af-radius-surface)] border border-[var(--af-border)] bg-[var(--af-surface)] p-4 sm:p-5"
  );

  // Empty options object
  assert.equal(
    surfaceClassName({}),
    "min-w-0 rounded-[var(--af-radius-surface)] border border-[var(--af-border)] bg-[var(--af-surface)] p-4 sm:p-5"
  );

  // All tones
  assert.ok(surfaceClassName({ tone: "subtle" }).includes("bg-[var(--af-surface-subtle)]"));
  assert.ok(surfaceClassName({ tone: "default" }).includes("bg-[var(--af-surface)]"));
  assert.ok(surfaceClassName({ tone: "raised" }).includes("bg-[var(--af-surface-raised)]"));
  assert.ok(surfaceClassName({ tone: "card" }).includes("bg-[var(--af-surface-card)]"));
  assert.ok(surfaceClassName({ tone: "canvas" }).includes("bg-[var(--af-canvas)]"));

  // All paddings
  assert.ok(surfaceClassName({ padding: "none" }).endsWith("bg-[var(--af-surface)]"));
  assert.ok(surfaceClassName({ padding: "sm" }).includes("p-4"));
  assert.ok(surfaceClassName({ padding: "md" }).includes("p-4 sm:p-5"));
  assert.ok(surfaceClassName({ padding: "lg" }).includes("p-5 sm:p-6 lg:p-8"));

  // Invalid / unknown tone fallback
  // @ts-expect-error Testing runtime fallback for untyped consumers
  const invalidTone = surfaceClassName({ tone: "non-existent-tone" });
  assert.ok(invalidTone.includes("bg-[var(--af-surface)]"));

  // Invalid / unknown padding fallback
  // @ts-expect-error Testing runtime fallback for untyped consumers
  const invalidPadding = surfaceClassName({ padding: "invalid-pad" });
  assert.ok(invalidPadding.includes("p-4 sm:p-5"));

  // Whitespace collapse with custom className
  const collapsed = surfaceClassName({
    tone: "raised",
    padding: "sm",
    className: "   custom-1    custom-2   \n  custom-3  ",
  });
  assert.equal(
    collapsed,
    "min-w-0 rounded-[var(--af-radius-surface)] border border-[var(--af-border)] bg-[var(--af-surface-raised)] p-4 custom-1 custom-2 custom-3"
  );
});

test("cardClassName: boundary and fallback robustness", () => {
  // Undefined options defaults to master variant and md padding
  assert.equal(
    cardClassName(),
    "min-w-0 rounded-2xl border border-white/10 bg-[#0e1619]/90 shadow-lg p-4 sm:p-5"
  );

  // Empty options object
  assert.equal(
    cardClassName({}),
    "min-w-0 rounded-2xl border border-white/10 bg-[#0e1619]/90 shadow-lg p-4 sm:p-5"
  );

  // All variants
  assert.ok(cardClassName({ variant: "master" }).includes("rounded-2xl border border-white/10 bg-[#0e1619]/90 shadow-lg"));
  assert.ok(cardClassName({ variant: "subtle" }).includes("rounded-xl border border-white/5 bg-white/[0.02]"));
  assert.ok(cardClassName({ variant: "accent" }).includes("rounded-2xl border border-teal-500/20 bg-[#0e1619]/90 shadow-[0_0_16px_rgba(45,212,191,0.15)]"));

  // All paddings
  assert.ok(cardClassName({ padding: "none" }).endsWith("shadow-lg"));
  assert.ok(cardClassName({ padding: "sm" }).includes("p-3 sm:p-4"));
  assert.ok(cardClassName({ padding: "md" }).includes("p-4 sm:p-5"));
  assert.ok(cardClassName({ padding: "lg" }).includes("p-5 sm:p-6 lg:p-8"));

  // Invalid / unknown variant fallback
  // @ts-expect-error Testing runtime fallback for untyped consumers
  const invalidVariant = cardClassName({ variant: "unknown-variant" });
  assert.ok(invalidVariant.includes("bg-[#0e1619]/90 shadow-lg"));

  // Invalid / unknown padding fallback
  // @ts-expect-error Testing runtime fallback for untyped consumers
  const invalidPad = cardClassName({ padding: "unknown-pad" });
  assert.ok(invalidPad.includes("p-4 sm:p-5"));

  // Whitespace collapse
  const collapsed = cardClassName({
    variant: "subtle",
    padding: "lg",
    className: "   flex    flex-col   gap-4   ",
  });
  assert.equal(
    collapsed,
    "min-w-0 rounded-xl border border-white/5 bg-white/[0.02] p-5 sm:p-6 lg:p-8 flex flex-col gap-4"
  );
});

// ============================================================================
// SUITE 4: Polymorphic Elements & HTML Prop Spreading
// ============================================================================

test("Polymorphic Rendering: Surface with all valid semantic tags", () => {
  const divSurface = Surface({ as: "div", children: "div" });
  assert.equal(divSurface.type, "div");

  const secSurface = Surface({ as: "section", children: "section" });
  assert.equal(secSurface.type, "section");

  const artSurface = Surface({ as: "article", children: "article" });
  assert.equal(artSurface.type, "article");

  const asideSurface = Surface({ as: "aside", children: "aside" });
  assert.equal(asideSurface.type, "aside");

  const headerSurface = Surface({ as: "header", children: "header" });
  assert.equal(headerSurface.type, "header");

  const footerSurface = Surface({ as: "footer", children: "footer" });
  assert.equal(footerSurface.type, "footer");
});

test("Polymorphic Rendering: Card with all valid semantic tags", () => {
  const divCard = Card({ as: "div", children: "div" });
  assert.equal(divCard.type, "div");

  const secCard = Card({ as: "section", children: "section" });
  assert.equal(secCard.type, "section");

  const artCard = Card({ as: "article", children: "article" });
  assert.equal(artCard.type, "article");

  const asideCard = Card({ as: "aside", children: "aside" });
  assert.equal(asideCard.type, "aside");

  const headerCard = Card({ as: "header", children: "header" });
  assert.equal(headerCard.type, "header");

  const footerCard = Card({ as: "footer", children: "footer" });
  assert.equal(footerCard.type, "footer");
});

test("Card Subcomponents: composition and hierarchy integrity", () => {
  const header = CardHeader({ className: "mb-2", children: "Header" });
  assert.equal(header.type, "div");
  assert.ok(header.props.className.includes("flex flex-col space-y-1.5 mb-2"));

  const title = CardTitle({ children: "Card Title" });
  assert.equal(title.type, "h3");
  assert.ok(title.props.className.includes("text-base font-semibold"));

  const desc = CardDescription({ children: "Card Description" });
  assert.equal(desc.type, "p");
  assert.ok(desc.props.className.includes("text-xs text-zinc-400"));

  const content = CardContent({ children: "Card Body" });
  assert.equal(content.type, "div");
  assert.ok(content.props.className.includes("pt-0"));

  const footer = CardFooter({ children: "Card Footer" });
  assert.equal(footer.type, "div");
  assert.ok(footer.props.className.includes("flex items-center pt-3"));
});
