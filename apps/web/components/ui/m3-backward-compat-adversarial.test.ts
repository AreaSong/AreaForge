import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import * as Ui from "@areaforge/ui";
import {
  Button,
  IconButton,
  buttonClassName,
  iconButtonClassName,
} from "./button";
import { IconButton as DedicatedIconButton } from "./icon-button";
import {
  PinnedActionBar,
  pinnedActionBarClassName,
  pinnedActionBarModeClasses,
  pinnedActionBarPaddingClasses,
} from "./pinned-action-bar";
import { EditorActionBar } from "./editor-actions";

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
// SUITE 1: Button Adversarial & Boundary Tests
// ============================================================================

test("Button: handles undefined, null, and empty options gracefully in buttonClassName", () => {
  // Empty object
  const emptyObj = buttonClassName({});
  assert.ok(emptyObj.includes("rounded-xl"));
  assert.ok(emptyObj.includes("bg-white/5"));
  assert.ok(emptyObj.includes("h-10"));

  // Empty string
  const emptyStr = buttonClassName("");
  assert.ok(emptyStr.includes("rounded-xl"));
  assert.ok(emptyStr.includes("bg-white/5"));

  // No arguments
  const noArgs = buttonClassName();
  assert.ok(noArgs.includes("rounded-xl"));
  assert.ok(noArgs.includes("bg-white/5"));

  // Extra whitespace normalization
  const messy = buttonClassName({ className: "  foo   bar   baz  " });
  assert.ok(messy.includes("foo bar baz"));
  assert.ok(!messy.includes("   "));
});

test("Button: all 6 variants produce valid distinctive CSS classes", () => {
  const variants: Ui.ButtonVariant[] = [
    "primary",
    "secondary",
    "ghost",
    "danger",
    "outline",
    "subtle",
  ];

  for (const variant of variants) {
    const cls = buttonClassName({ variant });
    assert.ok(cls.length > 0, `variant ${variant} must not be empty`);
    assert.ok(cls.includes("rounded-xl"), `variant ${variant} must have rounded-xl`);
  }
});

test("Button: all 4 sizes produce valid distinct height and typography classes", () => {
  const sizes: Ui.ButtonSize[] = ["sm", "md", "lg", "xl"];

  for (const size of sizes) {
    const cls = buttonClassName({ size });
    assert.ok(cls.includes(Ui.buttonSizeClasses[size]), `size ${size} must include size class`);
  }
});

test("Button: fullWidth flag correctly toggles w-full", () => {
  const normal = buttonClassName({ fullWidth: false });
  assert.ok(!normal.includes("w-full"));

  const full = buttonClassName({ fullWidth: true });
  assert.ok(full.includes("w-full"));
});

test("Button: loading state disables button and renders spinner with accessible announcement", () => {
  const loadingDefault = renderForwardRef(Button, {
    children: "Save Changes",
    loading: true,
  });
  assert.equal(loadingDefault.props.disabled, true);
  assert.equal(loadingDefault.props["aria-busy"], "true");

  const loadingCustom = renderForwardRef(Button, {
    children: "Save Changes",
    loading: true,
    loadingLabel: "Saving draft...",
  });
  assert.equal(loadingCustom.props.disabled, true);
  assert.equal(loadingCustom.props["aria-busy"], "true");
});

test("Button: leftIcon and rightIcon slots render correctly when idle and are omitted when loading", () => {
  const idleWithIcons = renderForwardRef(Button, {
    children: "Export",
    leftIcon: "📥",
    rightIcon: "↗",
  });
  assert.equal(idleWithIcons.props.disabled, false);

  const loadingWithIcons = renderForwardRef(Button, {
    children: "Export",
    loading: true,
    leftIcon: "📥",
    rightIcon: "↗",
  });
  assert.equal(loadingWithIcons.props.disabled, true);
  assert.equal(loadingWithIcons.props["aria-busy"], "true");
});

// ============================================================================
// SUITE 2: IconButton Adversarial & Boundary Tests
// ============================================================================

test("IconButton: handles all variant and size permutations while preserving aspect-square", () => {
  const variants: Ui.ButtonVariant[] = [
    "primary",
    "secondary",
    "ghost",
    "danger",
    "outline",
    "subtle",
  ];
  const sizes: Ui.ButtonSize[] = ["sm", "md", "lg", "xl"];

  for (const variant of variants) {
    for (const size of sizes) {
      const cls = iconButtonClassName({ variant, size });
      assert.ok(cls.includes("aspect-square"), `must maintain aspect-square for ${variant}/${size}`);
      assert.ok(cls.includes("!px-0"), `must enforce !px-0 for ${variant}/${size}`);
      assert.ok(cls.includes(Ui.iconButtonSizeClasses[size]), `must include size class for ${size}`);
    }
  }
});

test("IconButton: DedicatedIconButton in icon-button.tsx matches button.tsx re-export", () => {
  assert.equal(DedicatedIconButton, IconButton);
  assert.equal(DedicatedIconButton, Ui.IconButton);
});

test("IconButton: custom aria-label overrides default label prop", () => {
  const icon = renderForwardRef(IconButton, {
    label: "Filter Options",
    "aria-label": "Custom Filter Accessible Name",
    children: "⚙️",
  });
  assert.equal(icon.props["aria-label"], "Custom Filter Accessible Name");
  assert.equal(icon.props.title, "Filter Options");
});

// ============================================================================
// SUITE 3: PinnedActionBar & EditorActionBar Adversarial Tests
// ============================================================================

test("PinnedActionBar: all modes and paddings generate valid classes", () => {
  const modes: Ui.PinnedActionBarMode[] = ["sticky", "docked", "inline"];
  const paddings: Ui.PinnedActionBarPadding[] = ["none", "sm", "md", "lg"];

  for (const mode of modes) {
    for (const padding of paddings) {
      const cls = pinnedActionBarClassName({ mode, padding });
      assert.ok(cls.includes(pinnedActionBarModeClasses[mode]), `mode ${mode} class missing`);
      if (padding !== "none") {
        assert.ok(cls.includes(pinnedActionBarPaddingClasses[padding]), `padding ${padding} class missing`);
      }
    }
  }
});

test("PinnedActionBar: empty and direct children fallback works without slots", () => {
  const directChild = PinnedActionBar({
    children: React.createElement("span", null, "Custom Bar Content"),
  });
  assert.equal(directChild.type, "footer");
  assert.equal(directChild.props["data-pinned-action-bar"], "true");
  assert.equal(directChild.props["data-pinned-mode"], "sticky");
  assert.ok(directChild.props.children != null);
});

test("EditorActionBar: correctly renders secondary action button when provided and omits when omitted", () => {
  // Without secondary
  const primaryOnly = EditorActionBar({
    primaryLabel: "Save",
    onPrimary: () => {},
  });
  assert.equal(primaryOnly.type, PinnedActionBar);

  // With secondary
  const withSecondary = EditorActionBar({
    primaryLabel: "Save",
    onPrimary: () => {},
    secondaryLabel: "Cancel",
    onSecondary: () => {},
  });
  assert.equal(withSecondary.type, PinnedActionBar);
});

test("EditorActionBar: handles status, hint, and error simultaneously in left slot", () => {
  const fullLeft = EditorActionBar({
    primaryLabel: "Submit",
    onPrimary: () => {},
    hint: "Hint text",
    status: "Status badge",
    error: "Error notification",
  });
  assert.equal(fullLeft.type, PinnedActionBar);
});
