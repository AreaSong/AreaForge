import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import * as UiButton from "@areaforge/ui";
import * as WebButton from "./button";
import * as WebIconButton from "./icon-button";

// Helper to invoke forwardRef render function in unit tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderForwardRef(component: any, props: any, ref: unknown = null): any {
  if (typeof component === "function") {
    return component(props);
  }
  if (component && typeof component.render === "function") {
    return component.render(props, ref);
  }
  return React.createElement(component, props);
}

// ============================================================================
// SUITE 1: Monorepo Re-Export Equivalence & Architecture
// ============================================================================

test("Button Primitives: apps/web facade re-exports identical primitives and constants from @areaforge/ui", () => {
  assert.equal(WebButton.Button, UiButton.Button);
  assert.equal(WebButton.IconButton, UiButton.IconButton);
  assert.equal(WebIconButton.IconButton, UiButton.IconButton);
  assert.equal(WebButton.ButtonSpinner, UiButton.ButtonSpinner);
  assert.equal(WebButton.buttonClassName, UiButton.buttonClassName);
  assert.equal(WebButton.iconButtonClassName, UiButton.iconButtonClassName);
  assert.equal(WebIconButton.iconButtonClassName, UiButton.iconButtonClassName);
  assert.equal(WebButton.baseButtonClasses, UiButton.baseButtonClasses);
  assert.deepEqual(WebButton.buttonVariantClasses, UiButton.buttonVariantClasses);
  assert.deepEqual(WebButton.buttonSizeClasses, UiButton.buttonSizeClasses);
  assert.deepEqual(WebButton.iconButtonSizeClasses, UiButton.iconButtonSizeClasses);
  assert.deepEqual(WebIconButton.iconButtonSizeClasses, UiButton.iconButtonSizeClasses);
});

// ============================================================================
// SUITE 2: Button Tokens & Variant Class Generator
// ============================================================================

test("Button Tokens: baseButtonClasses matches /focus dark glass workstation specifications", () => {
  const base = UiButton.baseButtonClasses;
  assert.ok(base.includes("rounded-xl"), "must enforce rounded-xl control radius (12px)");
  assert.ok(base.includes("border"), "must include 1px border for layout stability");
  assert.ok(base.includes("font-medium"), "must enforce font-medium base typography");
  assert.ok(base.includes("select-none"), "must prevent text selection on fast clicks");
  assert.ok(base.includes("focus:outline-none"), "must suppress default browser outline");
  assert.ok(base.includes("focus-visible:ring-2"), "must provide high-contrast visible focus ring");
  assert.ok(base.includes("focus-visible:ring-teal-400/60"), "focus ring must use glowing teal accent");
  assert.ok(base.includes("disabled:cursor-not-allowed"), "disabled state must show not-allowed cursor");
  assert.ok(base.includes("disabled:opacity-50"), "disabled state must reduce opacity");
  assert.ok(base.includes("aria-disabled:pointer-events-none"), "aria-disabled must block pointer events");
});

test("Button Tokens: buttonVariantClasses defines all 6 canonical workstation variants", () => {
  const variants = UiButton.buttonVariantClasses;

  // Primary: Luminous teal CTA
  assert.ok(variants.primary.includes("bg-teal-400"), "primary must use bg-teal-400");
  assert.ok(variants.primary.includes("text-[#061012]"), "primary must use high-contrast dark text #061012");
  assert.ok(variants.primary.includes("shadow-[0_0_20px_rgba(45,212,191,0.35)]"), "primary must have ambient teal glow");
  assert.ok(variants.primary.includes("hover:bg-teal-300"), "primary hover must brighten to teal-300");
  assert.ok(variants.primary.includes("hover:shadow-[0_0_28px_rgba(45,212,191,0.5)]"), "primary hover must intensify glow");
  assert.ok(variants.primary.includes("active:scale-[0.98]"), "primary active must have tactile spring compression");
  assert.ok(variants.primary.includes("font-semibold"), "primary must have font-semibold");

  // Secondary: Dark glass translucent standard action
  assert.ok(variants.secondary.includes("border-white/10"), "secondary must have 10% white border");
  assert.ok(variants.secondary.includes("bg-white/5"), "secondary must have 5% white background");
  assert.ok(variants.secondary.includes("text-zinc-300"), "secondary text must be zinc-300");
  assert.ok(variants.secondary.includes("hover:border-white/20"), "secondary hover border must step to 20%");
  assert.ok(variants.secondary.includes("hover:bg-white/10"), "secondary hover bg must step to 10%");
  assert.ok(variants.secondary.includes("active:scale-[0.98]"), "secondary active must compress");

  // Ghost: Low-emphasis transparent action
  assert.ok(variants.ghost.includes("bg-transparent"), "ghost must be transparent at rest");
  assert.ok(variants.ghost.includes("text-zinc-400"), "ghost text must be zinc-400");
  assert.ok(variants.ghost.includes("hover:bg-white/5"), "ghost hover must show subtle 5% white fill");

  // Danger: Rose destructive action
  assert.ok(variants.danger.includes("border-rose-500/30"), "danger must have 30% rose border");
  assert.ok(variants.danger.includes("bg-rose-500/10"), "danger must have 10% rose background");
  assert.ok(variants.danger.includes("text-rose-300"), "danger text must be rose-300");
  assert.ok(variants.danger.includes("hover:bg-rose-500/20"), "danger hover must step to 20% rose");

  // Outline: Structured bordered action
  assert.ok(variants.outline.includes("border-white/20"), "outline must have 20% white border");
  assert.ok(variants.outline.includes("bg-transparent"), "outline must have transparent center");
  assert.ok(variants.outline.includes("hover:border-white/40"), "outline hover border must step to 40%");

  // Subtle: Minimalist card-matched fill
  assert.ok(variants.subtle.includes("border-white/5"), "subtle must have 5% white border");
  assert.ok(variants.subtle.includes("bg-white/[0.02]"), "subtle must have 2% white card-matched fill");
  assert.ok(variants.subtle.includes("text-zinc-300"), "subtle text must be zinc-300");
});

// ============================================================================
// SUITE 3: Button Sizes & Dimensions
// ============================================================================

test("Button Tokens: buttonSizeClasses and iconButtonSizeClasses adhere to ergonomic scales", () => {
  const sizes = UiButton.buttonSizeClasses;
  assert.equal(sizes.sm, "h-8 px-3 text-xs gap-1.5");
  assert.equal(sizes.md, "h-10 px-3.5 text-sm gap-2");
  assert.equal(sizes.lg, "h-11 px-5 text-sm gap-2");
  assert.equal(sizes.xl, "h-12 px-6 text-base gap-2.5");

  const iconSizes = UiButton.iconButtonSizeClasses;
  assert.equal(iconSizes.sm, "h-8 w-8 text-xs p-0");
  assert.equal(iconSizes.md, "h-10 w-10 text-sm p-0");
  assert.equal(iconSizes.lg, "h-11 w-11 text-sm p-0");
  assert.equal(iconSizes.xl, "h-12 w-12 text-base p-0");
});

// ============================================================================
// SUITE 4: buttonClassName & iconButtonClassName Options & Normalization
// ============================================================================

test("buttonClassName: generates expected classes with default fallback and custom overrides", () => {
  // Default: secondary + md
  const def = UiButton.buttonClassName();
  assert.ok(def.includes("rounded-xl"));
  assert.ok(def.includes("bg-white/5"));
  assert.ok(def.includes("h-10 px-3.5 text-sm"));

  // Primary + lg + fullWidth
  const primaryLgFull = UiButton.buttonClassName({
    variant: "primary",
    size: "lg",
    fullWidth: true,
    className: "my-custom-btn",
  });
  assert.ok(primaryLgFull.includes("bg-teal-400"));
  assert.ok(primaryLgFull.includes("h-11 px-5 text-sm"));
  assert.ok(primaryLgFull.includes("w-full"));
  assert.ok(primaryLgFull.endsWith("my-custom-btn"));

  // String overload fallback
  const strCustom = UiButton.buttonClassName("extra-class");
  assert.ok(strCustom.includes("bg-white/5"));
  assert.ok(strCustom.endsWith("extra-class"));
});

test("iconButtonClassName: generates square aspect-ratio classes with zero padding", () => {
  // Default: ghost + md + aspect-square + !px-0
  const def = UiButton.iconButtonClassName();
  assert.ok(def.includes("aspect-square"));
  assert.ok(def.includes("!px-0"));
  assert.ok(def.includes("h-10 w-10"));
  assert.ok(def.includes("bg-transparent"));

  // Secondary + sm
  const secSm = UiButton.iconButtonClassName({
    variant: "secondary",
    size: "sm",
    className: "toolbar-icon",
  });
  assert.ok(secSm.includes("aspect-square"));
  assert.ok(secSm.includes("h-8 w-8"));
  assert.ok(secSm.includes("bg-white/5"));
  assert.ok(secSm.endsWith("toolbar-icon"));

  // String overload
  const strCustom = UiButton.iconButtonClassName("extra-icon-class");
  assert.ok(strCustom.includes("aspect-square"));
  assert.ok(strCustom.endsWith("extra-icon-class"));
});

// ============================================================================
// SUITE 5: Button React Element & Behavioral Contract
// ============================================================================

test("Button Component: renders standard button element with accessible attributes and icons", () => {
  const btnElem = renderForwardRef(WebButton.Button, {
    children: "Save Draft",
    variant: "primary",
    size: "lg",
    leftIcon: "💾",
    rightIcon: "→",
  });

  assert.equal(btnElem.type, "button");
  assert.equal(btnElem.props.type, "button");
  assert.ok(btnElem.props.className.includes("bg-teal-400"));
  assert.ok(btnElem.props.className.includes("h-11"));

  // Loading state
  const loadingElem = renderForwardRef(WebButton.Button, {
    children: "Submit",
    loading: true,
    loadingLabel: "Saving to server...",
  });
  assert.equal(loadingElem.props.disabled, true);
  assert.equal(loadingElem.props["aria-busy"], "true");
});

// ============================================================================
// SUITE 6: IconButton React Element & Behavioral Contract
// ============================================================================

test("IconButton Component: enforces accessibility labels and square dimensions", () => {
  const iconElem = renderForwardRef(WebButton.IconButton, {
    label: "Close Panel",
    children: "✕",
    variant: "ghost",
    size: "sm",
  });

  assert.equal(iconElem.type, "button");
  assert.equal(iconElem.props.type, "button");
  assert.equal(iconElem.props["aria-label"], "Close Panel");
  assert.equal(iconElem.props.title, "Close Panel");
  assert.ok(iconElem.props.className.includes("aspect-square"));
  assert.ok(iconElem.props.className.includes("h-8 w-8"));

  // Loading state
  const loadingIcon = renderForwardRef(WebIconButton.IconButton, {
    label: "Refresh",
    loading: true,
  });
  assert.equal(loadingIcon.props.disabled, true);
  assert.equal(loadingIcon.props["aria-busy"], "true");
});

// ============================================================================
// SUITE 7: ButtonLink React Element & Next.js Integration
// ============================================================================

test("ButtonLink Component: provides polymorphic anchor and Next.js link support", () => {
  // packages/ui anchor Link
  const uiLink = renderForwardRef(UiButton.ButtonLink, {
    href: "/focus",
    children: "Go to Focus",
    variant: "primary",
    size: "md",
    ariaLabel: "Focus workstation",
  });
  assert.equal(uiLink.type, "a");
  assert.equal(uiLink.props.href, "/focus");
  assert.equal(uiLink.props["aria-label"], "Focus workstation");
  assert.ok(uiLink.props.className.includes("bg-teal-400"));

  // apps/web Next.js Link
  const webLink = renderForwardRef(WebButton.ButtonLink, {
    href: "/knowledge",
    children: "Open Knowledge",
    variant: "secondary",
    size: "lg",
  });
  assert.ok(webLink.props.className.includes("bg-white/5"));
  assert.ok(webLink.props.className.includes("h-11"));
});
