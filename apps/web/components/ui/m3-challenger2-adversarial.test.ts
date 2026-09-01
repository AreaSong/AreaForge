import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import * as Ui from "@areaforge/ui";
import {
  Button,
  ButtonLink,
  iconButtonClassName,
  baseButtonClasses,
  buttonVariantClasses,
} from "./button";
import {
  PinnedActionBar,
  pinnedActionBarClassName,
  pinnedActionBarModeClasses,
  pinnedActionBarPaddingClasses,
} from "./pinned-action-bar";
import { EditorActionBar } from "./editor-actions";

// Helper to extract props from React element
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inspectElement(element: any): { type: any; props: any } {
  assert.ok(element != null, "Element must not be null or undefined");
  return {
    type: element.type,
    props: element.props ?? {},
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderForwardRef(component: any, props: any): any {
  if (typeof component === "function") {
    return component(props);
  }
  if (component && typeof component.render === "function") {
    return component.render(props, null);
  }
  return React.createElement(component, props);
}

// ============================================================================
// SUITE 1: PinnedActionBar Zero-Scroll Ergonomics & Viewport Layout Guarantees
// ============================================================================

test("PinnedActionBar Ergonomics: sticky bottom-docking tokens enforce zero-scroll docking across viewports", () => {
  const stickyCls = pinnedActionBarModeClasses.sticky;

  // 1. Sticky positioning guarantees docking at viewport bottom without pushing content
  assert.ok(stickyCls.includes("sticky"), "Must have sticky positioning");
  assert.ok(stickyCls.includes("bottom-0"), "Must be docked at bottom-0");
  assert.ok(stickyCls.includes("z-10"), "Must maintain z-10 elevation over scrolling content");
  assert.ok(stickyCls.includes("w-full"), "Must span full width of parent container");

  // 2. High-contrast dark glass background & blur prevents bleed-through of scrolled text
  assert.ok(stickyCls.includes("bg-[#080b0f]/90"), "Must use 90% opacity obsidian background");
  assert.ok(stickyCls.includes("backdrop-blur-md"), "Must apply backdrop blur for glassmorphism");
  assert.ok(stickyCls.includes("border-t border-white/10"), "Must have top divider border-t border-white/10");

  // 3. Upward elevation shadow signals elevation over document body
  assert.ok(
    stickyCls.includes("shadow-[0_-4px_16px_rgba(0,0,0,0.4)]"),
    "Must have upward elevation shadow",
  );
});

test("PinnedActionBar Ergonomics: docked mode tokens enforce viewport fixed docking", () => {
  const dockedCls = pinnedActionBarModeClasses.docked;
  assert.ok(dockedCls.includes("fixed bottom-0 left-0 right-0"), "Must be fixed to viewport edges");
  assert.ok(dockedCls.includes("z-20"), "Must have z-20 elevation higher than sticky");
  assert.ok(dockedCls.includes("bg-[#080b0f]/95"), "Must use 95% opacity for fixed overlay");
  assert.ok(dockedCls.includes("backdrop-blur-md"), "Must have backdrop blur");
  assert.ok(dockedCls.includes("shadow-[0_-4px_20px_rgba(0,0,0,0.5)]"), "Must have stronger upward shadow");
});

test("PinnedActionBar Ergonomics: responsive padding prevents horizontal blowout on 1080p, 900p, and 768p", () => {
  // Check padding scaling
  assert.equal(pinnedActionBarPaddingClasses.none, "");
  assert.equal(pinnedActionBarPaddingClasses.sm, "px-3 py-2 sm:px-4");
  assert.equal(pinnedActionBarPaddingClasses.md, "px-4 py-3 sm:px-6");
  assert.equal(pinnedActionBarPaddingClasses.lg, "px-6 py-4 sm:px-8");

  // Class generator combines min-w-0, transition, mode, and padding
  const generated = pinnedActionBarClassName({ mode: "sticky", padding: "md" });
  assert.ok(generated.startsWith("min-w-0 transition-all sticky bottom-0"));
  assert.ok(generated.includes("px-4 py-3 sm:px-6"));
  assert.ok(!generated.includes("  "), "Whitespace must be normalized");
});

test("PinnedActionBar Layout: flex blowout defense & slot hierarchy under extreme text lengths", () => {
  const hugeText = "A".repeat(500);
  const element = PinnedActionBar({
    left: React.createElement("span", { id: "left-text" }, hugeText),
    center: React.createElement("span", { id: "center-text" }, hugeText),
    right: React.createElement("span", { id: "right-text" }, "Save"),
  });

  const { props } = inspectElement(element);
  const innerWrapper = props.children;
  assert.ok(innerWrapper != null, "Inner slot container must exist");

  // Check responsive flex container classes: column on mobile, row on >= sm
  assert.ok(
    innerWrapper.props.className.includes(
      "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
    ),
  );

  const [leftSlot, centerSlot, rightSlot] = innerWrapper.props.children;

  // Left slot must have min-w-0 to prevent flex blowout
  assert.ok(leftSlot.props.className.includes("min-w-0 flex items-center gap-3 text-xs leading-5 text-zinc-400"));
  // Center slot must have min-w-0 and sm:flex-1
  assert.ok(centerSlot.props.className.includes("min-w-0 flex items-center justify-center gap-2 text-xs text-zinc-400 sm:flex-1"));
  // Right slot must stack reverse on mobile and row on desktop
  assert.ok(rightSlot.props.className.includes("flex w-full flex-col-reverse items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end"));
});

test("PinnedActionBar Polymorphic Container: renders semantic HTML tags and data attributes", () => {
  const tags: Ui.PinnedActionBarElement[] = ["footer", "div", "nav", "section", "header"];

  for (const tag of tags) {
    const elem = PinnedActionBar({
      as: tag,
      children: "Test Child",
      className: "custom-bar",
    });
    const { type, props } = inspectElement(elem);
    assert.equal(type, tag, `Expected tag ${tag}`);
    assert.equal(props["data-pinned-action-bar"], "true");
    assert.equal(props["data-pinned-mode"], "sticky");
    assert.ok(props.className.includes("custom-bar"));
    assert.equal(props.children, "Test Child");
  }
});

test("PinnedActionBar Slot Fallbacks: status alias and children-only fallback work seamlessly", () => {
  // 1. Status prop aliases to left slot when left is omitted
  const statusOnly = PinnedActionBar({
    status: "Saved 5m ago",
    right: "Actions",
  });
  const { props: statusProps } = inspectElement(statusOnly);
  const [resolvedLeft] = statusProps.children.props.children;
  assert.equal(resolvedLeft.props.children, "Saved 5m ago");

  // 2. Direct children rendered when no slots are specified
  const childOnly = PinnedActionBar({
    children: React.createElement("div", { id: "custom-content" }, "Custom Layout"),
  });
  const { props: childProps } = inspectElement(childOnly);
  assert.equal(childProps.children.props.id, "custom-content");
});

// ============================================================================
// SUITE 2: EditorActionBar Backwards Compatibility with all 6 Consumers
// ============================================================================

test("EditorActionBar Consumer 1 Compatibility: task-detail-editor.tsx prop structure", () => {
  let requestCloseCalled = false;

  const editorBar = EditorActionBar({
    primaryType: "submit",
    primaryLabel: "保存任务",
    primaryIcon: React.createElement("svg", { id: "save-icon" }),
    primaryDisabled: false,
    loading: false,
    secondaryLabel: "关闭编辑",
    secondaryIcon: React.createElement("svg", { id: "close-icon" }),
    onSecondary: () => { requestCloseCalled = true; },
    hint: "保存后更新任务详情；关闭编辑不会写入服务端。",
  });

  const { type, props } = inspectElement(editorBar);
  assert.equal(type, PinnedActionBar);
  assert.equal(props.mode, "sticky");
  assert.equal(props.padding, "md");

  // Verify left slot content (hint)
  const left = props.left;
  assert.ok(left != null);
  const leftChildren = left.props.children; // [status, hint, error]
  assert.equal(leftChildren[0], null); // status
  assert.ok(leftChildren[1] != null); // hint container
  assert.equal(leftChildren[1].props.children, "保存后更新任务详情；关闭编辑不会写入服务端。");
  assert.equal(leftChildren[2], null); // error

  // Verify right slot buttons
  const right = props.right;
  const [extraActions, secondaryBtn, primaryBtn] = right.props.children;
  assert.equal(extraActions, undefined);

  // Check secondary button
  assert.equal(secondaryBtn.type, Button);
  assert.equal(secondaryBtn.props.type, "button");
  assert.equal(secondaryBtn.props.variant, "secondary");
  assert.equal(secondaryBtn.props.size, "lg");
  assert.equal(secondaryBtn.props.disabled, false);
  secondaryBtn.props.onClick();
  assert.equal(requestCloseCalled, true);

  // Check primary button
  assert.equal(primaryBtn.type, Button);
  assert.equal(primaryBtn.props.type, "submit");
  assert.equal(primaryBtn.props.variant, "primary");
  assert.equal(primaryBtn.props.size, "lg");
  assert.equal(primaryBtn.props.disabled, false);
  assert.equal(primaryBtn.props.loading, false);
});

test("EditorActionBar Consumer 2 Compatibility: note-detail-client.tsx prop structure", () => {
  let saveCalled = false;
  let discardCalled = false;

  const editorBar = EditorActionBar({
    primaryLabel: "保存卡片",
    primaryIcon: React.createElement("svg", { id: "save-icon" }),
    primaryDisabled: false,
    loading: false,
    onPrimary: () => { saveCalled = true; },
    secondaryLabel: "放弃编辑",
    secondaryIcon: React.createElement("svg", { id: "x-icon" }),
    secondaryDisabled: false,
    onSecondary: () => { discardCalled = true; },
    hint: "保存后更新卡片内容；放弃编辑会清除本机草稿。",
  });

  const { type, props } = inspectElement(editorBar);
  assert.equal(type, PinnedActionBar);

  const [, secondaryBtn, primaryBtn] = props.right.props.children;

  primaryBtn.props.onClick();
  assert.equal(saveCalled, true);

  secondaryBtn.props.onClick();
  assert.equal(discardCalled, true);
});

test("EditorActionBar Consumer 3 Compatibility: review-form.tsx prop structure (primary-only)", () => {
  const editorBar = EditorActionBar({
    primaryType: "submit",
    primaryLabel: "完成复盘",
    primaryIcon: React.createElement("svg", { id: "save-icon" }),
    primaryDisabled: false,
    loading: false,
    hint: "复盘和明日行动会一起保存，不会出现半份结果。",
  });

  const { type, props } = inspectElement(editorBar);
  assert.equal(type, PinnedActionBar);

  const [, secondaryBtn, primaryBtn] = props.right.props.children;
  assert.equal(secondaryBtn, null, "Secondary button must not render when secondaryLabel is omitted");
  assert.equal(primaryBtn.props.type, "submit");
  assert.equal(primaryBtn.props.variant, "primary");
});

test("EditorActionBar Consumer 4 Compatibility: syllabus-detail-editor.tsx prop structure", () => {
  let cancelCalled = false;

  const editorBar = EditorActionBar({
    primaryType: "submit",
    primaryLabel: "保存节点",
    primaryIcon: React.createElement("svg", { id: "save-icon" }),
    primaryDisabled: false,
    loading: false,
    secondaryLabel: "关闭编辑",
    secondaryIcon: React.createElement("svg", { id: "close-icon" }),
    onSecondary: () => { cancelCalled = true; },
    hint: "保存后更新节点结构；关闭编辑不会写入服务端。",
  });

  const { type, props } = inspectElement(editorBar);
  assert.equal(type, PinnedActionBar);
  const [, secondaryBtn, primaryBtn] = props.right.props.children;
  assert.ok(secondaryBtn != null);
  assert.ok(primaryBtn != null);
  secondaryBtn.props.onClick();
  assert.equal(cancelCalled, true);
});

test("EditorActionBar Consumer 5 Compatibility: mistake-detail-client.tsx prop structure", () => {
  let saveEditCalled = false;
  let cancelEditCalled = false;

  const editorBar = EditorActionBar({
    primaryLabel: "补全错题",
    primaryIcon: React.createElement("svg", { id: "save-icon" }),
    primaryDisabled: true,
    loading: true,
    onPrimary: () => { saveEditCalled = true; },
    secondaryLabel: "放弃编辑",
    secondaryIcon: React.createElement("svg", { id: "x-icon" }),
    secondaryDisabled: true,
    onSecondary: () => { cancelEditCalled = true; },
    hint: "保存后更新错因与正确思路；放弃编辑会清除本机草稿。",
  });

  const { type, props } = inspectElement(editorBar);
  assert.equal(type, PinnedActionBar);
  const [, secondaryBtn, primaryBtn] = props.right.props.children;

  // Secondary button disabled when loading or secondaryDisabled is true
  assert.equal(secondaryBtn.props.disabled, true);
  // Primary button disabled and loading
  assert.equal(primaryBtn.props.disabled, true);
  assert.equal(primaryBtn.props.loading, true);
  primaryBtn.props.onClick();
  assert.equal(saveEditCalled, true);
  secondaryBtn.props.onClick();
  assert.equal(cancelEditCalled, true);
});

test("EditorActionBar Consumer 6 Compatibility: study-resource-detail-client.tsx prop structure", () => {
  let saveResourceCalled = false;
  let cancelResourceCalled = false;

  const editorBar = EditorActionBar({
    primaryLabel: "保存资料整理",
    primaryIcon: React.createElement("svg", { id: "save-icon" }),
    primaryDisabled: false,
    loading: false,
    onPrimary: () => { saveResourceCalled = true; },
    secondaryLabel: "放弃编辑",
    secondaryIcon: React.createElement("svg", { id: "x-icon" }),
    secondaryDisabled: false,
    onSecondary: () => { cancelResourceCalled = true; },
    hint: "保存后更新资料元数据与关联；放弃编辑会清除本机草稿。",
  });

  const { type, props } = inspectElement(editorBar);
  assert.equal(type, PinnedActionBar);
  const [, secondaryBtn, primaryBtn] = props.right.props.children;
  assert.ok(secondaryBtn != null);
  assert.ok(primaryBtn != null);
  primaryBtn.props.onClick();
  assert.equal(saveResourceCalled, true);
  secondaryBtn.props.onClick();
  assert.equal(cancelResourceCalled, true);
});

// ============================================================================
// SUITE 3: Advanced EditorActionBar Edge Cases & Invariant Checks
// ============================================================================

test("EditorActionBar Edge Case: simultaneous status, hint, and error with extraActions and custom variants", () => {
  const customBar = EditorActionBar({
    primaryLabel: "确认删除",
    primaryVariant: "danger",
    secondaryLabel: "取消",
    secondaryVariant: "ghost",
    onSecondary: () => {},
    status: React.createElement("span", { id: "status" }, "已保存"),
    hint: React.createElement("span", { id: "hint" }, "危险操作"),
    error: React.createElement("span", { id: "error" }, "网络超时"),
    extraActions: React.createElement("button", { id: "extra-btn" }, "重试"),
    mode: "docked",
    padding: "lg",
    className: "editor-custom-dock",
  });

  const { type, props } = inspectElement(customBar);
  assert.equal(type, PinnedActionBar);
  assert.equal(props.mode, "docked");
  assert.equal(props.padding, "lg");
  assert.equal(props.className, "editor-custom-dock");

  // Check left slot content
  const left = props.left;
  const [statusElem, hintElem, errorElem] = left.props.children;
  assert.equal(statusElem.props.children.props.id, "status");
  assert.equal(hintElem.props.children.props.id, "hint");
  assert.equal(errorElem.props.children.props.id, "error");

  // Check right slot content
  const [extraActionElem, secondaryBtn, primaryBtn] = props.right.props.children;
  assert.equal(extraActionElem.props.id, "extra-btn");
  assert.equal(secondaryBtn.props.variant, "ghost");
  assert.equal(primaryBtn.props.variant, "danger");
});

// ============================================================================
// SUITE 4: Button & IconButton Token Invariants
// ============================================================================

test("Button Tokens: primary variant matches glowing teal token specification", () => {
  const primaryCls = buttonVariantClasses.primary;
  assert.ok(primaryCls.includes("bg-teal-400"), "Primary button must use bg-teal-400");
  assert.ok(primaryCls.includes("text-[#061012]"), "Primary button must use #061012 dark text");
  assert.ok(primaryCls.includes("shadow-[0_0_20px_rgba(45,212,191,0.35)]"), "Primary button must have 20px teal glow");
  assert.ok(primaryCls.includes("hover:bg-teal-300"), "Primary button must hover to bg-teal-300");
  assert.ok(primaryCls.includes("hover:shadow-[0_0_28px_rgba(45,212,191,0.5)]"), "Primary button must hover to 28px glow");
  assert.ok(primaryCls.includes("active:scale-[0.98]"), "Primary button must click compress to 0.98 scale");
});

test("Button Tokens: base button enforces 12px rounded-xl and keyboard accessibility focus rings", () => {
  assert.ok(baseButtonClasses.includes("rounded-xl"), "Buttons must use rounded-xl (12px)");
  assert.ok(baseButtonClasses.includes("focus-visible:ring-2"), "Buttons must have focus-visible ring");
  assert.ok(baseButtonClasses.includes("focus-visible:ring-teal-400/60"), "Buttons must have teal focus-visible ring");
  assert.ok(baseButtonClasses.includes("focus-visible:ring-offset-1"), "Buttons must have ring offset");
  assert.ok(baseButtonClasses.includes("disabled:cursor-not-allowed"), "Disabled buttons must show not-allowed cursor");
});

test("IconButton Tokens: guarantees aspect-square and !px-0 padding across all permutations", () => {
  const sizes: Ui.ButtonSize[] = ["sm", "md", "lg", "xl"];
  for (const size of sizes) {
    const cls = iconButtonClassName({ size });
    assert.ok(cls.includes("aspect-square"), "Must be square");
    assert.ok(cls.includes("!px-0"), "Must have !px-0");
  }
});

test("ButtonLink: apps/web ButtonLink renders Next.js Link with identical button classes", () => {
  const linkElem = renderForwardRef(ButtonLink, {
    href: "/today",
    variant: "primary",
    size: "lg",
    children: "进入今日",
  });

  const { props } = inspectElement(linkElem);
  assert.equal(props.href, "/today");
  assert.ok(props.className.includes("bg-teal-400"));
  assert.ok(props.className.includes("h-11 px-5 text-sm"));
  assert.equal(props.children, "进入今日");
});
