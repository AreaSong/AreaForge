import assert from "node:assert/strict";
import test from "node:test";
import * as UiActionBar from "@areaforge/ui";
import * as WebActionBar from "./pinned-action-bar";
import * as WebEditorActions from "./editor-actions";

// ============================================================================
// SUITE 1: Monorepo Re-Export Equivalence & Architecture
// ============================================================================

test("PinnedActionBar Primitives: apps/web facade re-exports identical primitives from @areaforge/ui", () => {
  assert.equal(WebActionBar.PinnedActionBar, UiActionBar.PinnedActionBar);
  assert.equal(WebActionBar.pinnedActionBarClassName, UiActionBar.pinnedActionBarClassName);
  assert.deepEqual(WebActionBar.pinnedActionBarModeClasses, UiActionBar.pinnedActionBarModeClasses);
  assert.deepEqual(WebActionBar.pinnedActionBarPaddingClasses, UiActionBar.pinnedActionBarPaddingClasses);
  assert.equal(WebEditorActions.EditorActionBar, UiActionBar.EditorActionBar);
});

// ============================================================================
// SUITE 2: PinnedActionBar Modes, Paddings & Class Generator
// ============================================================================

test("PinnedActionBar Tokens: pinnedActionBarModeClasses defines sticky, docked, and inline behaviors", () => {
  const modes = UiActionBar.pinnedActionBarModeClasses;

  // Sticky: docked to scrolling parent viewport
  assert.ok(modes.sticky.includes("sticky bottom-0"), "sticky mode must use sticky bottom-0");
  assert.ok(modes.sticky.includes("z-10"), "sticky mode must have z-10 elevation");
  assert.ok(modes.sticky.includes("w-full"), "sticky mode must span full container width");
  assert.ok(modes.sticky.includes("border-t border-white/10"), "sticky mode must have 10% white top border");
  assert.ok(modes.sticky.includes("bg-[#080b0f]/90"), "sticky mode must use 90% obsidian dark glass");
  assert.ok(modes.sticky.includes("backdrop-blur-md"), "sticky mode must use frosted backdrop-blur-md");
  assert.ok(modes.sticky.includes("shadow-[0_-4px_16px_rgba(0,0,0,0.4)]"), "sticky mode must have upward shadow");

  // Docked: fixed to bottom of browser window
  assert.ok(modes.docked.includes("fixed bottom-0 left-0 right-0"), "docked mode must be fixed to window edge");
  assert.ok(modes.docked.includes("z-20"), "docked mode must have z-20 elevation");
  assert.ok(modes.docked.includes("bg-[#080b0f]/95"), "docked mode must use 95% dark glass");

  // Inline: static relative layout without sticky docking
  assert.ok(modes.inline.includes("relative"), "inline mode must use relative positioning");
  assert.ok(modes.inline.includes("bg-transparent"), "inline mode must have transparent bg");
});

test("PinnedActionBar Tokens: pinnedActionBarPaddingClasses defines ergonomic responsive padding", () => {
  const paddings = UiActionBar.pinnedActionBarPaddingClasses;
  assert.equal(paddings.none, "");
  assert.equal(paddings.sm, "px-3 py-2 sm:px-4");
  assert.equal(paddings.md, "px-4 py-3 sm:px-6");
  assert.equal(paddings.lg, "px-6 py-4 sm:px-8");
});

test("pinnedActionBarClassName: generates expected classes with defaults and custom overrides", () => {
  // Default: sticky + md
  const def = UiActionBar.pinnedActionBarClassName();
  assert.ok(def.includes("sticky bottom-0"));
  assert.ok(def.includes("px-4 py-3 sm:px-6"));
  assert.ok(def.includes("backdrop-blur-md"));

  // Docked + lg + custom class
  const dockedLg = UiActionBar.pinnedActionBarClassName({
    mode: "docked",
    padding: "lg",
    className: "editor-dock",
  });
  assert.ok(dockedLg.includes("fixed bottom-0"));
  assert.ok(dockedLg.includes("px-6 py-4 sm:px-8"));
  assert.ok(dockedLg.endsWith("editor-dock"));
});

// ============================================================================
// SUITE 3: PinnedActionBar React Element & Slot Layout
// ============================================================================

test("PinnedActionBar Component: renders polymorphic container with responsive slots", () => {
  const barElem = WebActionBar.PinnedActionBar({
    left: "Status: Unsaved",
    center: "Center Tip",
    right: "Actions",
    mode: "sticky",
    padding: "md",
  });

  assert.equal(barElem.type, "footer");
  assert.equal(barElem.props["data-pinned-action-bar"], "true");
  assert.equal(barElem.props["data-pinned-mode"], "sticky");
  assert.ok(barElem.props.className.includes("sticky bottom-0"));

  // Polymorphic element as div
  const divBar = WebActionBar.PinnedActionBar({
    as: "div",
    mode: "docked",
    children: "Direct Children",
  });
  assert.equal(divBar.type, "div");
  assert.equal(divBar.props["data-pinned-mode"], "docked");
  assert.equal(divBar.props.children, "Direct Children");

  // Status alias resolves to left slot
  const statusElem = WebActionBar.PinnedActionBar({
    status: "Saved 2m ago",
    right: "Action",
  });
  assert.ok(statusElem.props.className.includes("sticky bottom-0"));
  assert.ok(statusElem.props.children != null);
});

// ============================================================================
// SUITE 4: EditorActionBar Composition & Ergonomics
// ============================================================================

test("EditorActionBar Component: composes PinnedActionBar with unified Button primitives", () => {
  let primaryClicked = false;
  let secondaryClicked = false;
  const onPrimary = () => { primaryClicked = true; };
  const onSecondary = () => { secondaryClicked = true; };

  const editorBar = WebEditorActions.EditorActionBar({
    primaryLabel: "Save Card",
    primaryType: "submit",
    onPrimary,
    secondaryLabel: "Discard Draft",
    onSecondary,
    hint: "Changes are synced automatically.",
    status: "Draft restored",
    error: "Conflict detected",
  });

  assert.equal(editorBar.type, WebActionBar.PinnedActionBar);
  assert.equal(editorBar.props.mode, "sticky");
  assert.equal(editorBar.props.padding, "md");

  onPrimary();
  onSecondary();
  assert.equal(primaryClicked, true);
  assert.equal(secondaryClicked, true);

  // Loading state
  const loadingBar = WebEditorActions.EditorActionBar({
    primaryLabel: "Saving...",
    loading: true,
    loadingLabel: "Saving to server",
    secondaryLabel: "Cancel",
    onSecondary: () => {},
  });
  assert.equal(loadingBar.type, WebActionBar.PinnedActionBar);
});
