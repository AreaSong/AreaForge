import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import * as UiField from "@areaforge/ui";
import * as UiSegmented from "@areaforge/ui";
import {
  Checkbox,
  Field,
  FormField,
  Input,
  Radio,
  Select,
  Textarea,
} from "./field";
import {
  SegmentedControl,
  SegmentedField,
  segmentedFieldColumnsClasses,
  segmentedFieldOptionClassName,
} from "./segmented-control";

interface TestElementProps {
  className?: string;
  children?: React.ReactNode;
  role?: string;
  htmlFor?: string;
  id?: string;
  type?: string;
  name?: string;
  value?: string | number | readonly string[];
  checked?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  minLength?: number;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  pattern?: string;
  autoComplete?: string;
  tabIndex?: number;
  placeholder?: string;
  defaultValue?: string | number | readonly string[];
  defaultChecked?: boolean;
  rows?: number;
  cols?: number;
  multiple?: boolean;
  size?: number;
  wrap?: string;
  spellCheck?: boolean;
  ref?: React.Ref<unknown>;
  "aria-invalid"?: boolean | "grammar" | "spelling";
  "aria-describedby"?: string;
  "aria-label"?: string;
  "aria-orientation"?: string;
  "aria-selected"?: boolean;
  "aria-hidden"?: boolean | "true" | "false";
  onClick?: (e: unknown) => void;
  onChange?: (e: unknown) => void;
  onFocus?: (e: unknown) => void;
  onBlur?: (e: unknown) => void;
  onKeyDown?: (e: unknown) => void;
  onKeyUp?: (e: unknown) => void;
  onInput?: (e: unknown) => void;
}

type TestElement = React.ReactElement<TestElementProps>;

function findChildByRole(children: React.ReactNode, role: string): TestElement | undefined {
  const list = React.Children.toArray(children) as TestElement[];
  return list.find((c) => c && typeof c === "object" && "props" in c && c.props.role === role);
}

function findChildByType(children: React.ReactNode, typeName: string): TestElement | undefined {
  const list = React.Children.toArray(children) as TestElement[];
  return list.find((c) => c && typeof c === "object" && c.type === typeName);
}

// ============================================================================
// SUITE 1: Target Existing Consumers Exact Pattern Replications
// ============================================================================

test("Consumer Compatibility: focus-session-panels.tsx form controls & SegmentedField", () => {
  // 1. SegmentedField for Closeout outcome
  let outcome = "achieved";
  const outcomeField = SegmentedField({
    legend: "收口结果",
    value: outcome,
    options: [
      { value: "achieved", label: "🎯 达成" },
      { value: "partial", label: "⚡ 部分达成" },
      { value: "not-achieved", label: "🚧 未达成" },
    ],
    onChange: (val) => {
      outcome = val;
    },
  });
  assert.equal(outcomeField.type, "fieldset");
  assert.ok(outcomeField.props.className?.includes("min-w-0"));

  // Check legend and options container
  const outcomeChildren = React.Children.toArray(outcomeField.props.children) as TestElement[];
  assert.equal(outcomeChildren[0].type, "legend");
  assert.equal(outcomeChildren[0].props.children, "收口结果");

  const optionsDiv = outcomeChildren.find(
    (c) => c.props.className && c.props.className.includes("af-segmented-options"),
  );
  assert.ok(optionsDiv, "must contain af-segmented-options container");
  const optionLabels = React.Children.toArray(optionsDiv?.props.children) as TestElement[];
  assert.equal(optionLabels.length, 3);

  // Active option has teal flare
  assert.ok(optionLabels[0].props.className?.includes("border-teal-400/80"));
  assert.ok(optionLabels[0].props.className?.includes("bg-teal-500/20"));
  assert.ok(optionLabels[0].props.className?.includes("text-teal-100"));
  assert.ok(optionLabels[0].props.className?.includes("shadow-[0_0_12px_rgba(45,212,191,0.2)]"));

  // Inactive options have subtle neutral styling
  assert.ok(optionLabels[1].props.className?.includes("border-white/10"));
  assert.ok(optionLabels[1].props.className?.includes("bg-white/[0.03]"));

  // 2. Checkbox with amber accent in LowReason list
  const reasonCheckbox = Checkbox({
    className: "h-3.5 w-3.5 shrink-0 accent-amber-300",
    checked: true,
    onChange: () => {},
  });
  assert.equal(reasonCheckbox.type, "input");
  assert.equal(reasonCheckbox.props.type, "checkbox");
  assert.equal(reasonCheckbox.props.checked, true);
  assert.ok(reasonCheckbox.props.className?.includes("accent-amber-300"));
  assert.ok(reasonCheckbox.props.className?.includes("h-3.5 w-3.5"));

  // 3. Textarea with controlHeight='sm', minLength, maxLength, custom classes
  const minimalOutputTextarea = Textarea({
    required: true,
    minLength: 4,
    maxLength: 1000,
    controlHeight: "sm",
    className:
      "mt-2 h-18 sm:h-22 min-h-18 rounded-xl border-white/10 bg-white/5 p-2.5 sm:p-3 text-xs sm:text-sm text-white placeholder:text-zinc-600 focus:border-teal-400 focus:outline-none resize-none leading-relaxed",
    placeholder: "例如：一元函数微分学理解了极值定理...",
    value: "完成了极限基础练习",
    onChange: () => {},
  });
  assert.equal(minimalOutputTextarea.type, "textarea");
  assert.equal(minimalOutputTextarea.props.required, true);
  assert.equal(minimalOutputTextarea.props.minLength, 4);
  assert.equal(minimalOutputTextarea.props.maxLength, 1000);
  assert.equal(minimalOutputTextarea.props.value, "完成了极限基础练习");
  assert.ok(minimalOutputTextarea.props.className?.includes("min-h-20"));
  assert.ok(minimalOutputTextarea.props.className?.includes("resize-none"));

  // 4. Input with custom h-8.5 class and maxLength
  const nextActionInput = Input({
    required: true,
    maxLength: 500,
    className:
      "mt-1.5 h-8.5 sm:h-9 rounded-xl border-white/10 bg-white/5 px-3 text-xs sm:text-sm text-white placeholder:text-zinc-600 focus:border-teal-400 focus:outline-none",
    placeholder: "下一次打开时要继续做什么",
    value: "做例题 4-6",
    onChange: () => {},
  });
  assert.equal(nextActionInput.type, "input");
  assert.equal(nextActionInput.props.required, true);
  assert.equal(nextActionInput.props.maxLength, 500);
  assert.equal(nextActionInput.props.value, "做例题 4-6");
  assert.ok(nextActionInput.props.className?.includes("h-8.5"));
});

test("Consumer Compatibility: review-form.tsx form controls & Field wrappers", () => {
  // 1. Field with label and htmlFor
  const summaryField = Field({
    label: "今天实际推进了什么",
    htmlFor: "daily-review-summary",
    children: Textarea({
      id: "daily-review-summary",
      name: "summary",
      className: "min-h-28 bg-[#0d1117]",
      placeholder: "用自己的话概括真正推进的内容",
      value: "复习了泰勒公式",
      required: true,
      onChange: () => {},
    }),
  });
  assert.equal(summaryField.type, "div");
  const summaryChildren = React.Children.toArray(summaryField.props.children) as TestElement[];
  assert.equal(summaryChildren[0].type, "label");
  assert.equal(summaryChildren[0].props.htmlFor, "daily-review-summary");
  const labelTextChildren = React.Children.toArray(summaryChildren[0].props.children);
  assert.equal(labelTextChildren[0], "今天实际推进了什么");

  // 2. Select in Field with custom options & bg-[#0d1117]
  const moodSelect = Select({
    id: "daily-review-mood",
    name: "mood",
    className: "h-11 bg-[#0d1117]",
    value: "有斗志",
    onChange: () => {},
    children: [
      React.createElement("option", { key: "none", value: "" }, "不记录"),
      React.createElement("option", { key: "focus", value: "有斗志" }, "有斗志"),
      React.createElement("option", { key: "tired", value: "很累" }, "很累"),
    ],
  });
  assert.equal(moodSelect.type, "select");
  assert.equal(moodSelect.props.id, "daily-review-mood");
  assert.equal(moodSelect.props.name, "mood");
  assert.equal(moodSelect.props.value, "有斗志");
  assert.ok(moodSelect.props.className?.includes("h-11"));
  assert.ok(moodSelect.props.className?.includes("bg-[#0d1117]"));
  assert.ok(moodSelect.props.className?.includes("[&>option]:bg-[#0e1619]"));

  // 3. Input with h-12 bg-[#0d1117] text-base
  const minActionInput = Input({
    id: "daily-review-tomorrow-minimum",
    name: "tomorrowMinimum",
    className: "h-12 bg-[#0d1117] text-base",
    placeholder: "例如：完成极限基础练习 20 题",
    value: "完成极限基础练习 20 题",
    required: true,
    onChange: () => {},
  });
  assert.equal(minActionInput.type, "input");
  assert.equal(minActionInput.props.required, true);
  assert.ok(minActionInput.props.className?.includes("h-12"));
  assert.ok(minActionInput.props.className?.includes("text-base"));
});

test("Consumer Compatibility: task-detail-editor.tsx controls & multi-select Checkboxes", () => {
  // 1. Task Title Input with maxLength={120}
  const titleInput = Input({
    className: "h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white",
    value: "数学复习任务",
    maxLength: 120,
    required: true,
    onChange: () => {},
  });
  assert.equal(titleInput.type, "input");
  assert.equal(titleInput.props.maxLength, 120);
  assert.equal(titleInput.props.required, true);
  assert.ok(titleInput.props.className?.includes("h-11"));

  // 2. Date Input
  const dateInput = Input({
    className: "h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white",
    type: "date",
    value: "2026-08-26",
    required: true,
    onChange: () => {},
  });
  assert.equal(dateInput.type, "input");
  assert.equal(dateInput.props.type, "date");
  assert.equal(dateInput.props.value, "2026-08-26");

  // 3. Number Input with min/max
  const minutesInput = Input({
    className: "h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white",
    type: "number",
    min: 5,
    max: 720,
    value: 60,
    onChange: () => {},
  });
  assert.equal(minutesInput.type, "input");
  assert.equal(minutesInput.props.type, "number");
  assert.equal(minutesInput.props.min, 5);
  assert.equal(minutesInput.props.max, 720);
  assert.equal(minutesInput.props.value, 60);

  // 4. Checkbox in list with mt-1
  let toggleCount = 0;
  const listCheckbox = Checkbox({
    className: "mt-1",
    checked: true,
    onChange: () => {
      toggleCount += 1;
    },
  });
  assert.equal(listCheckbox.type, "input");
  assert.equal(listCheckbox.props.type, "checkbox");
  assert.equal(listCheckbox.props.checked, true);
  assert.ok(listCheckbox.props.className?.includes("mt-1"));
  assert.ok(listCheckbox.props.className?.includes("accent-teal-400"));
  listCheckbox.props.onChange?.({} as React.ChangeEvent<HTMLInputElement>);
  assert.equal(toggleCount, 1);

  // 5. Textarea with maxLength={2000}
  const reviewTextarea = Textarea({
    className: "min-h-28 rounded-md border border-white/10 bg-[#0d1117] p-3 text-white",
    value: "任务复盘记录",
    maxLength: 2000,
    onChange: () => {},
  });
  assert.equal(reviewTextarea.type, "textarea");
  assert.equal(reviewTextarea.props.maxLength, 2000);
  assert.equal(reviewTextarea.props.value, "任务复盘记录");
});

test("Consumer Compatibility: experience-settings-client.tsx Radio and Select", () => {
  // 1. Radio control
  let selectedTheme = "standard";
  const radio = Radio({
    name: "theme",
    checked: selectedTheme === "standard",
    onChange: () => {
      selectedTheme = "contrast";
    },
  });
  assert.equal(radio.type, "input");
  assert.equal(radio.props.type, "radio");
  assert.equal(radio.props.name, "theme");
  assert.equal(radio.props.checked, true);
  assert.ok(radio.props.className?.includes("rounded-full"));
  assert.ok(radio.props.className?.includes("accent-teal-400"));

  // 2. Select with disabled={!ready}
  const textScaleSelect = Select({
    id: "experience-text-scale",
    disabled: false,
    value: "100",
    className: "h-11 bg-[#101419]",
    onChange: () => {},
    children: [
      React.createElement("option", { key: "100", value: "100" }, "100%"),
      React.createElement("option", { key: "112", value: "112" }, "112%"),
      React.createElement("option", { key: "125", value: "125" }, "125%"),
    ],
  });
  assert.equal(textScaleSelect.type, "select");
  assert.equal(textScaleSelect.props.disabled, false);
  assert.equal(textScaleSelect.props.value, "100");
  assert.ok(textScaleSelect.props.className?.includes("h-11 bg-[#101419]"));
});

test("Consumer Compatibility: note-detail-support.ts and note-detail-sections.tsx", () => {
  const noteEditorInputClass =
    "h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100";

  // 1. Input with noteEditorInputClass
  const noteTitleInput = Input({
    id: "note-title",
    disabled: false,
    value: "极限的定义与性质",
    className: noteEditorInputClass,
    onChange: () => {},
  });
  assert.equal(noteTitleInput.type, "input");
  assert.ok(noteTitleInput.props.className?.includes(noteEditorInputClass));

  // 2. MultiSelect with multiple=true and min-h-28
  const multiSelect = Select({
    multiple: true,
    disabled: false,
    value: ["node1", "node2"],
    className: "min-h-28 bg-[#151a20] p-2 text-zinc-100",
    onChange: () => {},
    children: [
      React.createElement("option", { key: "node1", value: "node1" }, "函数极限"),
      React.createElement("option", { key: "node2", value: "node2" }, "数列极限"),
    ],
  });
  assert.equal(multiSelect.type, "select");
  assert.equal(multiSelect.props.multiple, true);
  assert.deepEqual(multiSelect.props.value, ["node1", "node2"]);
  assert.ok(multiSelect.props.className?.includes("min-h-28"));

  // 3. Textarea with min-h-72 and font-mono
  const markdownTextarea = Textarea({
    disabled: false,
    value: "# 笔记内容\n- 重点 1\n- 重点 2",
    className: "min-h-72 w-full bg-[#151a20] px-3 py-2 font-mono text-sm leading-6 text-zinc-100",
    onChange: () => {},
  });
  assert.equal(markdownTextarea.type, "textarea");
  assert.ok(markdownTextarea.props.className?.includes("min-h-72"));
  assert.ok(markdownTextarea.props.className?.includes("font-mono"));
});

// ============================================================================
// SUITE 2: Field Component Error States, Required Markers, and Descriptions
// ============================================================================

test("Field: required marker rendering and accessibility attributes", () => {
  // 1. required = true -> renders amber asterisk with aria-hidden
  const reqField = Field({
    label: "必填科目",
    required: true,
    children: Input({ name: "subject" }),
  });
  const labelElem = findChildByType(reqField.props.children, "label");
  assert.ok(labelElem, "must render label");
  const labelChildren = React.Children.toArray(labelElem.props.children) as TestElement[];
  assert.equal(labelChildren[0], "必填科目");
  const asterisk = labelChildren[1];
  assert.equal(asterisk.type, "span");
  assert.equal(asterisk.props.children, "*");
  assert.equal(asterisk.props["aria-hidden"], "true");
  assert.ok(asterisk.props.className?.includes("text-amber-300"));

  // 2. required = false / undefined -> no asterisk
  const optionalField = Field({
    label: "选填备注",
    required: false,
    children: Input({ name: "notes" }),
  });
  const optLabel = findChildByType(optionalField.props.children, "label");
  const optChildren = React.Children.toArray(optLabel?.props.children);
  assert.equal(optChildren.length, 1);
  assert.equal(optChildren[0], "选填备注");
});

test("Field: error message rendering, role='alert', and aria invariants", () => {
  // 1. error present -> renders <p role="alert" className="text-xs leading-5 text-rose-300">
  const errField = Field({
    label: "密码",
    error: "密码长度必须大于 8 位",
    children: Input({ type: "password" }),
  });
  const alertElem = findChildByRole(errField.props.children, "alert");
  assert.ok(alertElem, "must render alert element for error");
  assert.equal(alertElem.type, "p");
  assert.equal(alertElem.props.children, "密码长度必须大于 8 位");
  assert.ok(alertElem.props.className?.includes("text-rose-300"));
  assert.ok(alertElem.props.className?.includes("text-xs leading-5"));

  // 2. error absent -> no alert element
  const cleanField = Field({
    label: "邮箱",
    children: Input({ type: "email" }),
  });
  const cleanAlert = findChildByRole(cleanField.props.children, "alert");
  assert.equal(cleanAlert, undefined, "clean field must not have alert element");
});

test("Field: description vs hint precedence and htmlFor binding", () => {
  // 1. description provided
  const descField = Field({
    label: "用户名",
    htmlFor: "usr-id",
    description: "用于登录的主账号名称",
    children: Input({ id: "usr-id" }),
  });
  const labelElem = findChildByType(descField.props.children, "label");
  assert.equal(labelElem?.props.htmlFor, "usr-id");

  const descChildren = React.Children.toArray(descField.props.children) as TestElement[];
  const descP = descChildren.find((c) => c.type === "p" && !c.props.role);
  assert.ok(descP);
  assert.equal(descP.props.children, "用于登录的主账号名称");

  // 2. hint provided when description is omitted
  const hintField = Field({
    label: "重试间隔",
    hint: "单位：毫秒",
    children: Input({ type: "number" }),
  });
  const hintChildren = React.Children.toArray(hintField.props.children) as TestElement[];
  const hintP = hintChildren.find((c) => c.type === "p" && !c.props.role);
  assert.ok(hintP);
  assert.equal(hintP.props.children, "单位：毫秒");

  // 3. description overrides hint
  const bothField = Field({
    label: "优先级",
    description: "首选说明文字",
    hint: "次选提示文字",
    children: Select({}),
  });
  const bothChildren = React.Children.toArray(bothField.props.children) as TestElement[];
  const bothP = bothChildren.find((c) => c.type === "p" && !c.props.role);
  assert.ok(bothP);
  assert.equal(bothP.props.children, "首选说明文字");

  // 4. FormField is exact alias
  assert.equal(FormField, Field);
});

// ============================================================================
// SUITE 3: Control Height Scales & Class Overrides
// ============================================================================

test("Input & Select: controlHeight scales ('sm', 'md', 'lg', 'xl')", () => {
  // Input heights
  const inputSm = Input({ controlHeight: "sm" });
  assert.ok(inputSm.props.className?.includes("h-8 px-3 text-xs"));

  const inputMd = Input({ controlHeight: "md" });
  assert.ok(inputMd.props.className?.includes("h-10 px-3.5 text-sm"));

  const inputLg = Input({ controlHeight: "lg" });
  assert.ok(inputLg.props.className?.includes("h-11 px-4 text-sm"));

  const inputXl = Input({ controlHeight: "xl" });
  assert.ok(inputXl.props.className?.includes("h-12 px-4 text-base"));

  // Select heights
  const selectSm = Select({ controlHeight: "sm" });
  assert.ok(selectSm.props.className?.includes("h-8 px-3 text-xs"));
  assert.ok(selectSm.props.className?.includes("[&>option]:bg-[#0e1619]"));

  const selectLg = Select({ controlHeight: "lg" });
  assert.ok(selectLg.props.className?.includes("h-11 px-4 text-sm"));

  const selectXl = Select({ controlHeight: "xl" });
  assert.ok(selectXl.props.className?.includes("h-12 px-4 text-base"));
});

test("Textarea: controlHeight scales ('sm', 'md', 'lg')", () => {
  const taSm = Textarea({ controlHeight: "sm" });
  assert.ok(taSm.props.className?.includes("min-h-20"));
  assert.ok(taSm.props.className?.includes("resize-y p-3 text-sm"));

  const taMd = Textarea({ controlHeight: "md" });
  assert.ok(taMd.props.className?.includes("min-h-24"));

  const taLg = Textarea({ controlHeight: "lg" });
  assert.ok(taLg.props.className?.includes("min-h-32"));
});

// ============================================================================
// SUITE 4: Ref Forwarding, Native HTML Attributes, and Event Propagation
// ============================================================================

test("Ref Forwarding & React 19 Prop Passthrough: Input, Select, Textarea, Checkbox, Radio", () => {
  const inputRef = React.createRef<HTMLInputElement>();
  const input = Input({ ref: inputRef, id: "test-input" });
  assert.equal(input.props.ref, inputRef);
  assert.equal(input.props.id, "test-input");

  const selectRef = React.createRef<HTMLSelectElement>();
  const select = Select({ ref: selectRef, id: "test-select" });
  assert.equal(select.props.ref, selectRef);

  const textareaRef = React.createRef<HTMLTextAreaElement>();
  const textarea = Textarea({ ref: textareaRef, id: "test-textarea" });
  assert.equal(textarea.props.ref, textareaRef);

  const checkboxRef = React.createRef<HTMLInputElement>();
  const checkbox = Checkbox({ ref: checkboxRef, id: "test-checkbox" });
  assert.equal(checkbox.props.ref, checkboxRef);

  const radioRef = React.createRef<HTMLInputElement>();
  const radio = Radio({ ref: radioRef, id: "test-radio" });
  assert.equal(radio.props.ref, radioRef);
});

test("Native HTML Form Attributes & Validation Passthrough", () => {
  let focused = false;
  let blurred = false;
  let changedVal = "";
  let keyPressed = "";

  const input = Input({
    type: "search",
    name: "q",
    value: "query",
    readOnly: true,
    autoFocus: true,
    tabIndex: 2,
    "aria-invalid": true,
    "aria-describedby": "search-help",
    onFocus: () => {
      focused = true;
    },
    onBlur: () => {
      blurred = true;
    },
    onChange: (e) => {
      const target = (e as React.ChangeEvent<HTMLInputElement>).target;
      changedVal = target?.value ?? "";
    },
    onKeyDown: (e) => {
      const keyEvent = e as React.KeyboardEvent<HTMLInputElement>;
      keyPressed = keyEvent.key;
    },
  });

  assert.equal(input.props.type, "search");
  assert.equal(input.props.name, "q");
  assert.equal(input.props.value, "query");
  assert.equal(input.props.readOnly, true);
  assert.equal(input.props.autoFocus, true);
  assert.equal(input.props.tabIndex, 2);
  assert.equal(input.props["aria-invalid"], true);
  assert.equal(input.props["aria-describedby"], "search-help");

  input.props.onFocus?.({} as React.FocusEvent<HTMLInputElement>);
  assert.equal(focused, true);

  input.props.onBlur?.({} as React.FocusEvent<HTMLInputElement>);
  assert.equal(blurred, true);

  input.props.onChange?.({ target: { value: "new-query" } } as unknown as React.ChangeEvent<HTMLInputElement>);
  assert.equal(changedVal, "new-query");

  input.props.onKeyDown?.({ key: "Escape" } as React.KeyboardEvent<HTMLInputElement>);
  assert.equal(keyPressed, "Escape");
});

// ============================================================================
// SUITE 5: SegmentedField & SegmentedControl Advanced Form Stress
// ============================================================================

test("SegmentedField: handles undefined/missing description and error states cleanly", () => {
  // Scenario 1: Legend only, no description, no error
  const field1 = SegmentedField({
    legend: "简短标题",
    value: "opt1",
    options: [{ value: "opt1", label: "选项 1" }],
    onChange: () => {},
  });
  assert.equal(field1.type, "fieldset");
  const children1 = React.Children.toArray(field1.props.children) as TestElement[];
  assert.equal(children1.length, 2, "must have legend and options container");
  assert.equal(children1[0].type, "legend");
  assert.equal(children1[0].props.children, "简短标题");
  assert.ok(children1[1].props.className?.includes("af-segmented-options"));

  // Scenario 2: With description AND error
  const field2 = SegmentedField({
    legend: "带错误字段",
    description: "请仔细阅读说明",
    error: "必选项目未满足",
    value: "opt1",
    options: [{ value: "opt1", label: "选项 1" }],
    onChange: () => {},
  });
  const children2 = React.Children.toArray(field2.props.children) as TestElement[];
  assert.equal(children2.length, 4, "must have legend, description, options, and error");
  assert.equal(children2[0].type, "legend");
  assert.equal(children2[1].type, "p");
  assert.equal(children2[1].props.children, "请仔细阅读说明");
  assert.ok(children2[2].props.className?.includes("af-segmented-options"));
  assert.equal(children2[3].type, "p");
  assert.equal(children2[3].props.role, "alert");
  assert.equal(children2[3].props.children, "必选项目未满足");
  assert.ok(children2[3].props.className?.includes("text-rose-300"));
});

test("SegmentedControl & SegmentedField: density, sizing, and column matrices", () => {
  // SegmentedControl sizes
  const smControl = SegmentedControl({
    value: "tab1",
    label: "标签",
    size: "sm",
    options: [{ value: "tab1", label: "Tab 1" }],
    onChange: () => {},
  });
  assert.equal(smControl.type, "div");
  assert.equal(smControl.props.role, "tablist");

  // Auto columns
  assert.equal(
    segmentedFieldColumnsClasses.auto,
    "grid-cols-2 sm:grid-flow-col sm:auto-cols-fr",
  );

  // Column numbers
  ([1, 2, 3, 4, 5] as const).forEach((cols) => {
    assert.ok(typeof segmentedFieldColumnsClasses[cols] === "string");
  });

  // Compact vs normal density classes
  const compact = segmentedFieldOptionClassName({ density: "compact" });
  assert.ok(compact.includes("min-h-8 px-2.5 py-1 text-xs"));

  const normal = segmentedFieldOptionClassName({ density: "normal" });
  assert.ok(normal.includes("min-h-10 px-3.5 py-1.5 text-xs sm:text-sm"));
});

test("Monorepo re-export integrity: UiField and UiSegmented parity", () => {
  assert.equal(Field, UiField.Field);
  assert.equal(Input, UiField.Input);
  assert.equal(Select, UiField.Select);
  assert.equal(Textarea, UiField.Textarea);
  assert.equal(Checkbox, UiField.Checkbox);
  assert.equal(Radio, UiField.Radio);
  assert.equal(SegmentedControl, UiSegmented.SegmentedControl);
  assert.equal(SegmentedField, UiSegmented.SegmentedField);
});
