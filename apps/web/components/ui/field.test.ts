import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import * as UiField from "@areaforge/ui";
import * as WebField from "./field";

interface TestElementProps {
  className?: string;
  children?: React.ReactNode;
  role?: string;
  htmlFor?: string;
  id?: string;
  type?: string;
  name?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  tabIndex?: number;
  placeholder?: string;
  defaultValue?: string;
  rows?: number;
  defaultChecked?: boolean;
}

type TestElement = React.ReactElement<TestElementProps>;

// ============================================================================
// SUITE 1: Monorepo Re-Export Equivalence & Architecture
// ============================================================================

test("Field Primitives: apps/web facade re-exports identical primitives from @areaforge/ui", () => {
  assert.equal(WebField.Field, UiField.Field);
  assert.equal(WebField.FormField, UiField.FormField);
  assert.equal(WebField.Input, UiField.Input);
  assert.equal(WebField.Select, UiField.Select);
  assert.equal(WebField.Textarea, UiField.Textarea);
  assert.equal(WebField.Checkbox, UiField.Checkbox);
  assert.equal(WebField.Radio, UiField.Radio);
  assert.equal(WebField.formControlClassName, UiField.formControlClassName);
  assert.equal(WebField.inputClassName, UiField.inputClassName);
  assert.equal(WebField.selectClassName, UiField.selectClassName);
  assert.equal(WebField.textareaClassName, UiField.textareaClassName);
  assert.equal(WebField.checkboxClassName, UiField.checkboxClassName);
  assert.equal(WebField.radioClassName, UiField.radioClassName);
  assert.equal(WebField.fieldClassName, UiField.fieldClassName);
  assert.equal(WebField.baseControlClasses, UiField.baseControlClasses);
  assert.deepEqual(WebField.controlHeightClasses, UiField.controlHeightClasses);
  assert.deepEqual(WebField.textareaHeightClasses, UiField.textareaHeightClasses);
});

// ============================================================================
// SUITE 2: Base Control Tokens & Class Generators
// ============================================================================

test("Field Tokens: baseControlClasses matches /focus dark glass workstation specifications", () => {
  const base = UiField.baseControlClasses;
  assert.ok(base.includes("rounded-xl"), "must use rounded-xl (12px)");
  assert.ok(base.includes("border-white/10"), "must use border-white/10");
  assert.ok(base.includes("bg-white/5"), "must use bg-white/5 surface");
  assert.ok(base.includes("text-white"), "must use text-white");
  assert.ok(base.includes("placeholder:text-zinc-600"), "must use placeholder:text-zinc-600");
  assert.ok(base.includes("focus:border-teal-400"), "must use focus:border-teal-400");
  assert.ok(base.includes("focus:outline-none"), "must use focus:outline-none");
  assert.ok(base.includes("focus:ring-1 focus:ring-teal-400/20"), "must use focus ring");
  assert.ok(base.includes("disabled:cursor-not-allowed disabled:opacity-50"), "must style disabled state");
  assert.ok(base.includes("transition-colors"), "must have color transition");
});

test("formControlClassName: supports string and options overload with height and invalid state", () => {
  // 1. Default (no args)
  const defaultClass = UiField.formControlClassName();
  assert.ok(defaultClass.includes("rounded-xl border border-white/10 bg-white/5"));

  // 2. String argument (backward compatibility with legacy call sites)
  const stringArgClass = UiField.formControlClassName("custom-class extra-padding");
  assert.ok(stringArgClass.endsWith("custom-class extra-padding"));
  assert.ok(stringArgClass.includes("rounded-xl"));

  // 3. Options object with controlHeight
  assert.ok(UiField.formControlClassName({ controlHeight: "sm" }).includes("h-8 px-3 text-xs"));
  assert.ok(UiField.formControlClassName({ controlHeight: "md" }).includes("h-10 px-3.5 text-sm"));
  assert.ok(UiField.formControlClassName({ controlHeight: "lg" }).includes("h-11 px-4 text-sm"));
  assert.ok(UiField.formControlClassName({ controlHeight: "xl" }).includes("h-12 px-4 text-base"));

  // 4. Invalid state
  const invalidClass = UiField.formControlClassName({ invalid: true });
  assert.ok(invalidClass.includes("border-rose-400/60"));
  assert.ok(invalidClass.includes("focus:border-rose-400/70"));
});

test("inputClassName and selectClassName: configure ergonomic heights and dark popup options", () => {
  // inputClassName defaults to md (h-10)
  const defaultInput = UiField.inputClassName();
  assert.ok(defaultInput.includes("h-10 px-3.5 text-sm"));

  // inputClassName with explicit lg height
  const lgInput = UiField.inputClassName({ controlHeight: "lg", className: "w-full" });
  assert.ok(lgInput.includes("h-11 px-4 text-sm"));
  assert.ok(lgInput.includes("w-full"));

  // selectClassName includes dark background for native option dropdowns
  const defaultSelect = UiField.selectClassName();
  assert.ok(defaultSelect.includes("[&>option]:bg-[#0e1619]"));
  assert.ok(defaultSelect.includes("[&>option]:text-white"));
  assert.ok(defaultSelect.includes("h-10 px-3.5 text-sm"));
});

test("textareaClassName: handles min-height scales and resize-y", () => {
  // Default md height
  const defaultTextarea = UiField.textareaClassName();
  assert.ok(defaultTextarea.includes("min-h-24"));
  assert.ok(defaultTextarea.includes("resize-y p-3 text-sm"));

  // sm height
  const smTextarea = UiField.textareaClassName({ controlHeight: "sm" });
  assert.ok(smTextarea.includes("min-h-20"));

  // lg height
  const lgTextarea = UiField.textareaClassName({ controlHeight: "lg" });
  assert.ok(lgTextarea.includes("min-h-32"));

  // invalid state
  const invalidTextarea = UiField.textareaClassName({ invalid: true });
  assert.ok(invalidTextarea.includes("border-rose-400/60"));
});

test("checkboxClassName and radioClassName: style selection controls with teal accent", () => {
  const checkbox = UiField.checkboxClassName();
  assert.ok(checkbox.includes("h-4 w-4 shrink-0 rounded"));
  assert.ok(checkbox.includes("accent-teal-400"));
  assert.ok(checkbox.includes("border-white/20"));

  const radio = UiField.radioClassName("my-radio");
  assert.ok(radio.includes("h-4 w-4 shrink-0 rounded-full"));
  assert.ok(radio.includes("accent-teal-400"));
  assert.ok(radio.includes("my-radio"));
});

test("fieldClassName: ensures grid container formatting", () => {
  assert.equal(UiField.fieldClassName(), "grid min-w-0 gap-2");
  assert.equal(UiField.fieldClassName("max-w-md"), "grid min-w-0 gap-2 max-w-md");
});

// ============================================================================
// SUITE 3: Field & FormField Component Structure
// ============================================================================

test("Field component: renders label, required indicator, description, hint, and error", () => {
  // 1. Basic Field
  const basic = UiField.Field({
    label: "用户名",
    htmlFor: "username-input",
    children: React.createElement("input", { id: "username-input" }),
  });
  assert.equal(basic.type, "div");
  assert.ok(basic.props.className.includes("grid min-w-0 gap-2"));

  // 2. Field with required flag and hint
  const requiredField = UiField.Field({
    label: "考纲节点",
    required: true,
    hint: "请选择目标考纲节点",
    children: "Child Content",
  });
  const [labelElem, hintElem, contentElem, errorElem] = React.Children.toArray(
    requiredField.props.children,
  ) as TestElement[];

  assert.equal(labelElem.type, "label");
  assert.ok(labelElem.props.className?.includes("text-sm font-medium text-zinc-300"));
  assert.ok(hintElem.props.className?.includes("text-xs leading-5 text-zinc-500"));
  assert.equal(hintElem.props.children, "请选择目标考纲节点");
  assert.equal(contentElem.props.children, "Child Content");
  assert.equal(errorElem, undefined);

  // 3. Field with error state (role="alert")
  const errorField = UiField.Field({
    label: "密码",
    error: "密码不能为空",
    children: "Input Element",
  });
  const childrenWithErr = React.Children.toArray(
    errorField.props.children,
  ) as TestElement[];
  const renderedError = childrenWithErr.find(
    (child) => child && child.props && child.props.role === "alert",
  );
  assert.ok(renderedError);
  assert.equal(renderedError.props.children, "密码不能为空");
  assert.ok(renderedError.props.className?.includes("text-rose-300"));

  // 4. FormField is an exact alias
  const formField = UiField.FormField({
    label: "别名测试",
    children: "Content",
  });
  assert.equal(formField.type, "div");
});

// ============================================================================
// SUITE 4: Interactive Input Primitives JSX Creation
// ============================================================================

test("Input, Select, Textarea, Checkbox, Radio: construct valid React elements", () => {
  // Input
  const inputElem = UiField.Input({
    placeholder: "搜索知识点...",
    controlHeight: "lg",
    disabled: true,
  });
  assert.equal(inputElem.type, "input");
  assert.equal(inputElem.props.placeholder, "搜索知识点...");
  assert.equal(inputElem.props.disabled, true);
  assert.ok(inputElem.props.className?.includes("h-11 px-4 text-sm"));

  // Select
  const selectElem = UiField.Select({
    defaultValue: "math",
    children: [React.createElement("option", { key: "math", value: "math" }, "高等数学")],
  });
  assert.equal(selectElem.type, "select");
  assert.equal(selectElem.props.defaultValue, "math");
  assert.ok(selectElem.props.className?.includes("[&>option]:bg-[#0e1619]"));

  // Textarea
  const textareaElem = UiField.Textarea({
    rows: 4,
    controlHeight: "sm",
    placeholder: "写下复盘内容...",
  });
  assert.equal(textareaElem.type, "textarea");
  assert.equal(textareaElem.props.rows, 4);
  assert.ok(textareaElem.props.className?.includes("min-h-20"));

  // Checkbox
  const checkboxElem = UiField.Checkbox({
    name: "remember",
    defaultChecked: true,
  });
  assert.equal(checkboxElem.type, "input");
  assert.equal(checkboxElem.props.type, "checkbox");
  assert.equal(checkboxElem.props.defaultChecked, true);
  assert.ok(checkboxElem.props.className?.includes("accent-teal-400"));

  // Radio
  const radioElem = UiField.Radio({
    name: "mode",
    value: "paper",
  });
  assert.equal(radioElem.type, "input");
  assert.equal(radioElem.props.type, "radio");
  assert.equal(radioElem.props.value, "paper");
  assert.ok(radioElem.props.className?.includes("rounded-full"));
});
