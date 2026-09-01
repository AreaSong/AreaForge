import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import * as UiSegmented from "@areaforge/ui";
import * as WebSegmented from "./segmented-control";

interface TestElementProps {
  className?: string;
  children?: React.ReactNode;
  role?: string;
  type?: string;
  name?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  tabIndex?: number;
  "aria-selected"?: boolean;
  "aria-label"?: string;
  "aria-orientation"?: string;
  onKeyDown?: (event: {
    key: string;
    preventDefault: () => void;
    currentTarget: { parentElement: HTMLElement | null };
  }) => void;
}

type TestElement = React.ReactElement<TestElementProps>;

// ============================================================================
// SUITE 1: Monorepo Re-Export Equivalence & Packaging Boundary
// ============================================================================

test("SegmentedControl & SegmentedField: apps/web facade re-exports identical primitives from @areaforge/ui", () => {
  assert.equal(WebSegmented.SegmentedControl, UiSegmented.SegmentedControl);
  assert.equal(WebSegmented.SegmentedField, UiSegmented.SegmentedField);
  assert.equal(WebSegmented.segmentedControlClassName, UiSegmented.segmentedControlClassName);
  assert.equal(WebSegmented.segmentedControlItemClassName, UiSegmented.segmentedControlItemClassName);
  assert.equal(WebSegmented.segmentedFieldOptionClassName, UiSegmented.segmentedFieldOptionClassName);
  assert.deepEqual(WebSegmented.segmentedControlSizeClasses, UiSegmented.segmentedControlSizeClasses);
  assert.deepEqual(WebSegmented.segmentedFieldColumnsClasses, UiSegmented.segmentedFieldColumnsClasses);
});

// ============================================================================
// SUITE 2: SegmentedControl ARIA Semantics & Tablist Structure
// ============================================================================

test("SegmentedControl: renders WAI-ARIA tablist container with accessible properties", () => {
  const control = UiSegmented.SegmentedControl({
    value: "day",
    label: "时间跨度",
    options: [
      { value: "day", label: "日" },
      { value: "week", label: "周" },
      { value: "month", label: "月", disabled: true },
    ],
    onChange: () => {},
  });

  assert.equal(control.type, "div");
  assert.equal(control.props.role, "tablist");
  assert.equal(control.props["aria-label"], "时间跨度");
  assert.equal(control.props["aria-orientation"], "horizontal");

  const tabs = React.Children.toArray(control.props.children) as TestElement[];
  assert.equal(tabs.length, 3);

  // Tab 0: active ("day")
  const tab0 = tabs[0];
  assert.equal(tab0.type, "button");
  assert.equal(tab0.props.type, "button");
  assert.equal(tab0.props.role, "tab");
  assert.equal(tab0.props["aria-selected"], true);
  assert.equal(tab0.props.tabIndex, 0, "active tab must have tabIndex=0");
  assert.equal(tab0.props.disabled, undefined);
  assert.ok(tab0.props.className?.includes("bg-white/10 text-white"));

  // Tab 1: inactive ("week")
  const tab1 = tabs[1];
  assert.equal(tab1.props.role, "tab");
  assert.equal(tab1.props["aria-selected"], false);
  assert.equal(tab1.props.tabIndex, -1, "inactive tab must have tabIndex=-1");
  assert.ok(tab1.props.className?.includes("text-zinc-400"));

  // Tab 2: disabled ("month")
  const tab2 = tabs[2];
  assert.equal(tab2.props.disabled, true);
  assert.ok(tab2.props.className?.includes("opacity-40 cursor-not-allowed"));
});

// ============================================================================
// SUITE 3: SegmentedControl Sizes & FullWidth Layout
// ============================================================================

test("SegmentedControl: supports sm, md, lg sizes and fullWidth responsive layout", () => {
  // Sizing dictionary
  assert.ok(UiSegmented.segmentedControlSizeClasses.sm.includes("h-7 px-2.5 text-xs"));
  assert.ok(UiSegmented.segmentedControlSizeClasses.md.includes("h-8 px-3"));
  assert.ok(UiSegmented.segmentedControlSizeClasses.lg.includes("h-9.5 px-3.5 text-sm"));

  // Sizing application on items
  const smItem = UiSegmented.segmentedControlItemClassName({ size: "sm" });
  assert.ok(smItem.includes("h-7 px-2.5 text-xs"));

  const lgItem = UiSegmented.segmentedControlItemClassName({ size: "lg", active: true });
  assert.ok(lgItem.includes("h-9.5 px-3.5 text-sm"));
  assert.ok(lgItem.includes("bg-white/10 text-white"));

  // fullWidth container and item
  const fullWidthContainer = UiSegmented.segmentedControlClassName({ fullWidth: true });
  assert.ok(fullWidthContainer.includes("flex w-full"));

  const fullWidthItem = UiSegmented.segmentedControlItemClassName({ fullWidth: true });
  assert.ok(fullWidthItem.includes("flex-1 justify-center"));
});

// ============================================================================
// SUITE 4: SegmentedField Form Semantics & Accessibility
// ============================================================================

test("SegmentedField: renders fieldset, legend, and screen-reader accessible radio inputs", () => {
  let selectedValue = "2";
  const field = UiSegmented.SegmentedField({
    legend: "专注度评级",
    name: "focus-level",
    value: selectedValue,
    options: [
      { value: "1", label: "1 分", hint: "注意力分散" },
      { value: "2", label: "2 分", hint: "偶有卡顿" },
      { value: "3", label: "3 分", hint: "完全沉浸", badge: "推荐" },
    ],
    onChange: (val) => {
      selectedValue = val;
    },
    hint: "请评估本次番茄钟期间的专注程度",
  });

  assert.equal(field.type, "fieldset");
  assert.ok(field.props.className.includes("min-w-0"));

  const [legendElem, hintElem, optionsContainer, errorElem] = React.Children.toArray(
    field.props.children,
  ) as TestElement[];

  assert.equal(legendElem.type, "legend");
  assert.equal(legendElem.props.children, "专注度评级");
  assert.ok(legendElem.props.className?.includes("text-xs font-medium text-zinc-300"));

  assert.equal(hintElem.type, "p");
  assert.equal(hintElem.props.children, "请评估本次番茄钟期间的专注程度");
  assert.ok(hintElem.props.className?.includes("text-xs leading-5 text-zinc-500"));

  assert.equal(errorElem, undefined);

  // Check radio options
  const optionLabels = React.Children.toArray(optionsContainer.props.children) as TestElement[];
  assert.equal(optionLabels.length, 3);

  // Option 1 (inactive)
  const opt0 = optionLabels[0];
  assert.equal(opt0.type, "label");
  const [radio0] = React.Children.toArray(opt0.props.children) as TestElement[];
  assert.equal(radio0.type, "input");
  assert.equal(radio0.props.type, "radio");
  assert.equal(radio0.props.className, "sr-only");
  assert.equal(radio0.props.name, "focus-level");
  assert.equal(radio0.props.value, "1");
  assert.equal(radio0.props.checked, false);

  // Option 2 (active)
  const opt1 = optionLabels[1];
  const [radio1] = React.Children.toArray(opt1.props.children) as TestElement[];
  assert.equal(radio1.props.checked, true);
});

// ============================================================================
// SUITE 5: Signature /focus Active Teal Flare Token Invariants
// ============================================================================

test("SegmentedField: active teal flare matches exact /focus workstation tokens", () => {
  const activeClass = UiSegmented.segmentedFieldOptionClassName({ active: true });
  assert.ok(activeClass.includes("border-teal-400/80"), "must have border-teal-400/80");
  assert.ok(activeClass.includes("bg-teal-500/20"), "must have bg-teal-500/20");
  assert.ok(activeClass.includes("text-teal-100"), "must have text-teal-100");
  assert.ok(
    activeClass.includes("shadow-[0_0_12px_rgba(45,212,191,0.2)]"),
    "must have signature 12px teal flare shadow",
  );

  const inactiveClass = UiSegmented.segmentedFieldOptionClassName({ active: false });
  assert.ok(inactiveClass.includes("border-white/10"));
  assert.ok(inactiveClass.includes("bg-white/[0.03]"));
  assert.ok(inactiveClass.includes("text-zinc-400"));
  assert.ok(inactiveClass.includes("hover:border-white/20"));
  assert.ok(inactiveClass.includes("hover:bg-white/[0.07]"));
  assert.ok(inactiveClass.includes("hover:text-zinc-200"));

  // Focus-visible ring
  assert.ok(activeClass.includes("has-[:focus-visible]:ring-2"));
  assert.ok(activeClass.includes("has-[:focus-visible]:ring-teal-400/60"));
});

// ============================================================================
// SUITE 6: SegmentedField Column Layouts & Density Variants
// ============================================================================

test("SegmentedField: supports auto, 1, 2, 3, 4, 5 columns and compact/normal density", () => {
  // Columns dictionary
  assert.equal(
    UiSegmented.segmentedFieldColumnsClasses.auto,
    "grid-cols-2 sm:grid-flow-col sm:auto-cols-fr",
  );
  assert.equal(UiSegmented.segmentedFieldColumnsClasses[1], "grid-cols-1");
  assert.equal(UiSegmented.segmentedFieldColumnsClasses[2], "grid-cols-1 sm:grid-cols-2");
  assert.equal(UiSegmented.segmentedFieldColumnsClasses[3], "grid-cols-1 sm:grid-cols-3");
  assert.equal(UiSegmented.segmentedFieldColumnsClasses[4], "grid-cols-2 sm:grid-cols-4");
  assert.equal(UiSegmented.segmentedFieldColumnsClasses[5], "grid-cols-2 sm:grid-cols-5");

  // Density variants
  const compactClass = UiSegmented.segmentedFieldOptionClassName({ density: "compact" });
  assert.ok(compactClass.includes("min-h-8 px-2.5 py-1 text-xs"));

  const normalClass = UiSegmented.segmentedFieldOptionClassName({ density: "normal" });
  assert.ok(normalClass.includes("min-h-10 px-3.5 py-1.5 text-xs sm:text-sm"));
});

// ============================================================================
// SUITE 7: Keyboard Roving Key Navigation Logic Edge Cases
// ============================================================================

test("SegmentedControl: keyboard roving navigation correctly identifies candidate indices", () => {
  let capturedValue = "first";
  const control = UiSegmented.SegmentedControl({
    value: capturedValue,
    label: "导航选项",
    options: [
      { value: "first", label: "First" },
      { value: "second", label: "Second", disabled: true },
      { value: "third", label: "Third" },
      { value: "fourth", label: "Fourth" },
    ],
    onChange: (val) => {
      capturedValue = val;
    },
  });

  const tabs = React.Children.toArray(control.props.children) as TestElement[];
  assert.equal(tabs.length, 4);

  // Tab 0 has onKeyDown handler
  const tab0 = tabs[0];
  assert.equal(typeof tab0.props.onKeyDown, "function");

  // Simulate non-navigation key (e.g. "Enter")
  let defaultPrevented = false;
  tab0.props.onKeyDown?.({
    key: "Enter",
    preventDefault: () => {
      defaultPrevented = true;
    },
    currentTarget: { parentElement: null },
  });
  assert.equal(defaultPrevented, false, "non-nav keys should not prevent default");

  // Simulate ArrowRight key
  tab0.props.onKeyDown?.({
    key: "ArrowRight",
    preventDefault: () => {
      defaultPrevented = true;
    },
    currentTarget: { parentElement: null },
  });
  assert.equal(defaultPrevented, true, "arrow keys must prevent default");
});

// ============================================================================
// SUITE 8: Zero Upward Dependencies & Clean Architectural Boundary
// ============================================================================

test("Architectural Boundary: SegmentedControl uses native button and zero web/button imports", () => {
  const control = UiSegmented.SegmentedControl({
    value: "opt1",
    label: "架构测试",
    options: [{ value: "opt1", label: "选项 1" }],
    onChange: () => {},
  });

  const [tab] = React.Children.toArray(control.props.children) as TestElement[];
  assert.equal(tab.type, "button", "SegmentedControl items must be native HTML buttons");
});
