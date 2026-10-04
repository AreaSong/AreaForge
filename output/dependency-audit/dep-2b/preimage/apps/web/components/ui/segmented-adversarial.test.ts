import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import * as UiSegmented from "@areaforge/ui";
import * as UiField from "@areaforge/ui";

interface MockDOMElement {
  focused: boolean;
  role?: string;
  focus: () => void;
}

interface MockParentContainer {
  querySelectorAll: (selector: string) => MockDOMElement[];
}

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
    currentTarget: { parentElement: MockParentContainer | null };
  }) => void;
  onClick?: (event: React.MouseEvent) => void;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

type TestElement = React.ReactElement<TestElementProps>;

// Helper to find options container in SegmentedField output
function findOptionsContainer(field: TestElement): TestElement {
  const children = React.Children.toArray(field.props.children) as TestElement[];
  const container = children.find(
    (c) => c && c.props && typeof c.props.className === "string" && c.props.className.includes("af-segmented-options")
  );
  if (!container) {
    throw new Error("Could not find af-segmented-options container");
  }
  return container;
}

// Helper to extract radio input from label
function extractRadio(labelElem: TestElement): TestElement {
  const children = React.Children.toArray(labelElem.props.children) as TestElement[];
  const radio = children.find(
    (c) => c && c.props && c.props.type === "radio"
  );
  if (!radio) {
    throw new Error("Could not find radio input inside label");
  }
  return radio;
}

// Dummy change event for testing
const dummyChangeEvent = {} as React.ChangeEvent<HTMLInputElement>;

// ============================================================================
// ADVERSARIAL SUITE 1: SegmentedControl Keyboard Roving Navigation Edge Cases
// ============================================================================

test("ADVERSARIAL: SegmentedControl keyboard roving - circular wrapping and disabled skipping", () => {
  let currentValue = "c";
  const options = [
    { value: "a", label: "Option A" },
    { value: "b", label: "Option B", disabled: true },
    { value: "c", label: "Option C" },
    { value: "d", label: "Option D", disabled: true },
    { value: "e", label: "Option E", disabled: true },
    { value: "f", label: "Option F" },
  ];

  const createMockParent = () => {
    const elements: MockDOMElement[] = options.map((): MockDOMElement => ({
      focused: false,
      role: "tab",
      focus() {
        elements.forEach((el) => {
          el.focused = false;
        });
        this.focused = true;
      },
    }));
    return {
      elements,
      parentElement: {
        querySelectorAll: (selector: string) => (selector === '[role="tab"]' ? elements : []),
      },
    };
  };

  // Test 1: From 'c' (index 2), ArrowRight should skip disabled 'd' and 'e' and reach 'f' (index 5)
  {
    const mock = createMockParent();
    const control = UiSegmented.SegmentedControl({
      value: "c",
      label: "Test",
      options,
      onChange: (val) => {
        currentValue = val;
      },
    });
    const tabs = React.Children.toArray(control.props.children) as TestElement[];
    let prevented = false;
    tabs[2].props.onKeyDown?.({
      key: "ArrowRight",
      preventDefault: () => {
        prevented = true;
      },
      currentTarget: { parentElement: mock.parentElement },
    });
    assert.equal(prevented, true);
    assert.equal(currentValue, "f", "ArrowRight from 'c' must skip 'd','e' and land on 'f'");
    assert.equal(mock.elements[5].focused, true, "DOM focus must be moved to element 5 ('f')");
  }

  // Test 2: From 'f' (index 5), ArrowRight should wrap around, land on 'a' (index 0)
  {
    const mock = createMockParent();
    const control = UiSegmented.SegmentedControl({
      value: "f",
      label: "Test",
      options,
      onChange: (val) => {
        currentValue = val;
      },
    });
    const tabs = React.Children.toArray(control.props.children) as TestElement[];
    let prevented = false;
    tabs[5].props.onKeyDown?.({
      key: "ArrowRight",
      preventDefault: () => {
        prevented = true;
      },
      currentTarget: { parentElement: mock.parentElement },
    });
    assert.equal(prevented, true);
    assert.equal(currentValue, "a", "ArrowRight from 'f' must wrap around to 'a'");
    assert.equal(mock.elements[0].focused, true, "DOM focus must wrap to element 0 ('a')");
  }

  // Test 3: From 'a' (index 0), ArrowLeft should wrap backwards to 'f' (index 5), skipping 'd','e'
  {
    const mock = createMockParent();
    const control = UiSegmented.SegmentedControl({
      value: "a",
      label: "Test",
      options,
      onChange: (val) => {
        currentValue = val;
      },
    });
    const tabs = React.Children.toArray(control.props.children) as TestElement[];
    let prevented = false;
    tabs[0].props.onKeyDown?.({
      key: "ArrowLeft",
      preventDefault: () => {
        prevented = true;
      },
      currentTarget: { parentElement: mock.parentElement },
    });
    assert.equal(prevented, true);
    assert.equal(currentValue, "f", "ArrowLeft from 'a' must wrap backwards to 'f'");
    assert.equal(mock.elements[5].focused, true, "DOM focus must land on element 5 ('f')");
  }

  // Test 4: From 'f' (index 5), ArrowLeft should land on 'c' (index 2), skipping 'e','d'
  {
    const mock = createMockParent();
    const control = UiSegmented.SegmentedControl({
      value: "f",
      label: "Test",
      options,
      onChange: (val) => {
        currentValue = val;
      },
    });
    const tabs = React.Children.toArray(control.props.children) as TestElement[];
    let prevented = false;
    tabs[5].props.onKeyDown?.({
      key: "ArrowLeft",
      preventDefault: () => {
        prevented = true;
      },
      currentTarget: { parentElement: mock.parentElement },
    });
    assert.equal(prevented, true);
    assert.equal(currentValue, "c", "ArrowLeft from 'f' must skip 'e','d' and land on 'c'");
    assert.equal(mock.elements[2].focused, true, "DOM focus must land on element 2 ('c')");
  }
});

test("ADVERSARIAL: SegmentedControl Home and End keys with disabled boundaries", () => {
  let currentValue = "middle";
  // Boundary scenario: first item (index 0) is disabled, last item (index 4) is disabled
  const options = [
    { value: "0-disabled", label: "0", disabled: true },
    { value: "1-first-enabled", label: "1" },
    { value: "2-middle", label: "2" },
    { value: "3-last-enabled", label: "3" },
    { value: "4-disabled", label: "4", disabled: true },
  ];

  const elements: MockDOMElement[] = options.map((): MockDOMElement => ({
    focused: false,
    role: "tab",
    focus() {
      elements.forEach((el) => {
        el.focused = false;
      });
      this.focused = true;
    },
  }));
  const parentMock: MockParentContainer = {
    querySelectorAll: (selector: string) => (selector === '[role="tab"]' ? elements : []),
  };

  const control = UiSegmented.SegmentedControl({
    value: "2-middle",
    label: "Boundary Test",
    options,
    onChange: (val) => {
      currentValue = val;
    },
  });
  const tabs = React.Children.toArray(control.props.children) as TestElement[];

  // Home key from middle -> should land on index 1 ("1-first-enabled"), skipping index 0
  tabs[2].props.onKeyDown?.({
    key: "Home",
    preventDefault: () => {},
    currentTarget: { parentElement: parentMock },
  });
  assert.equal(currentValue, "1-first-enabled");
  assert.equal(elements[1].focused, true);

  // End key from middle -> should land on index 3 ("3-last-enabled"), skipping index 4
  tabs[2].props.onKeyDown?.({
    key: "End",
    preventDefault: () => {},
    currentTarget: { parentElement: parentMock },
  });
  assert.equal(currentValue, "3-last-enabled");
  assert.equal(elements[3].focused, true);
});

test("ADVERSARIAL: SegmentedControl with ALL options disabled or SINGLE enabled option", () => {
  // Scenario A: All disabled
  const allDisabledOptions = [
    { value: "x", label: "X", disabled: true },
    { value: "y", label: "Y", disabled: true },
  ];
  let changed = false;
  const controlAllDisabled = UiSegmented.SegmentedControl({
    value: "x",
    label: "All Disabled",
    options: allDisabledOptions,
    onChange: () => {
      changed = true;
    },
  });
  const tabsAllDisabled = React.Children.toArray(controlAllDisabled.props.children) as TestElement[];
  // None should have tabIndex = 0
  assert.equal(tabsAllDisabled[0].props.tabIndex, -1);
  assert.equal(tabsAllDisabled[1].props.tabIndex, -1);

  // Key navigation should do nothing and not throw
  tabsAllDisabled[0].props.onKeyDown?.({
    key: "ArrowRight",
    preventDefault: () => {},
    currentTarget: { parentElement: null },
  });
  assert.equal(changed, false);

  // Scenario B: Only 1 enabled out of 3
  const singleEnabledOptions = [
    { value: "d1", label: "D1", disabled: true },
    { value: "only", label: "Only Enabled" },
    { value: "d2", label: "D2", disabled: true },
  ];
  const controlSingle = UiSegmented.SegmentedControl({
    value: "only",
    label: "Single Enabled",
    options: singleEnabledOptions,
    onChange: () => {},
  });
  const tabsSingle = React.Children.toArray(controlSingle.props.children) as TestElement[];
  assert.equal(tabsSingle[1].props.tabIndex, 0);
  assert.equal(tabsSingle[0].props.tabIndex, -1);
  assert.equal(tabsSingle[2].props.tabIndex, -1);

  // Navigating ArrowRight should find 'only' itself and call onChange with 'only'
  let singleVal = "";
  const singleMock: MockParentContainer = {
    querySelectorAll: () => [
      { focused: false, focus: () => {} },
      { focused: false, focus: () => {} },
      { focused: false, focus: () => {} },
    ],
  };
  const controlSingleNav = UiSegmented.SegmentedControl({
    value: "only",
    label: "Single Enabled",
    options: singleEnabledOptions,
    onChange: (val) => {
      singleVal = val;
    },
  });
  const tabsSingleNav = React.Children.toArray(controlSingleNav.props.children) as TestElement[];
  tabsSingleNav[1].props.onKeyDown?.({
    key: "ArrowRight",
    preventDefault: () => {},
    currentTarget: { parentElement: singleMock },
  });
  assert.equal(singleVal, "only");
});

test("ADVERSARIAL: SegmentedControl with empty options or unmatched value", () => {
  // Empty options
  const emptyControl = UiSegmented.SegmentedControl({
    value: "none",
    label: "Empty",
    options: [],
    onChange: () => {},
  });
  assert.equal(React.Children.count(emptyControl.props.children), 0);

  // Unmatched value (e.g. initial state before selection)
  const unmatchedControl = UiSegmented.SegmentedControl({
    value: "unknown",
    label: "Unmatched",
    options: [
      { value: "opt1", label: "Option 1" },
      { value: "opt2", label: "Option 2" },
    ],
    onChange: () => {},
  });
  const unmatchedTabs = React.Children.toArray(unmatchedControl.props.children) as TestElement[];
  // Roving index should fall back to first enabled option (index 0)
  assert.equal(unmatchedTabs[0].props.tabIndex, 0);
  assert.equal(unmatchedTabs[1].props.tabIndex, -1);
  assert.equal(unmatchedTabs[0].props["aria-selected"], false);
  assert.equal(unmatchedTabs[1].props["aria-selected"], false);
});

test("ADVERSARIAL: SegmentedControl property-based roving navigation invariant fuzzing", () => {
  // Generate pseudo-random arrays of 10-30 options with random disabled flags
  for (let seed = 1; seed <= 20; seed += 1) {
    const length = 10 + (seed % 15);
    const options = Array.from({ length }, (_, i) => ({
      value: `val-${i}`,
      label: `Label ${i}`,
      disabled: (i + seed) % 3 === 0, // pattern of disabled items
    }));

    const enabledIndices = options.map((opt, i) => (opt.disabled ? -1 : i)).filter((i) => i >= 0);
    if (enabledIndices.length === 0) continue;

    const initialIndex = enabledIndices[0];
    let activeValue = options[initialIndex].value;

    const elements: MockDOMElement[] = options.map((): MockDOMElement => ({
      focused: false,
      role: "tab",
      focus() {
        elements.forEach((el) => {
          el.focused = false;
        });
        this.focused = true;
      },
    }));
    const mockParent: MockParentContainer = {
      querySelectorAll: (sel: string) => (sel === '[role="tab"]' ? elements : []),
    };

    // Forward walk across all enabled items
    for (let step = 0; step < enabledIndices.length; step += 1) {
      const control = UiSegmented.SegmentedControl({
        value: activeValue,
        label: `Fuzz ${seed}`,
        options,
        onChange: (v) => {
          activeValue = v;
        },
      });
      const tabs = React.Children.toArray(control.props.children) as TestElement[];
      const curIdx = options.findIndex((o) => o.value === activeValue);
      tabs[curIdx].props.onKeyDown?.({
        key: "ArrowRight",
        preventDefault: () => {},
        currentTarget: { parentElement: mockParent },
      });

      const nextExpectedPos = (enabledIndices.indexOf(curIdx) + 1) % enabledIndices.length;
      const nextExpectedIdx = enabledIndices[nextExpectedPos];
      assert.equal(
        activeValue,
        options[nextExpectedIdx].value,
        `Forward roving failed on seed ${seed} at step ${step}`,
      );
      assert.equal(
        elements[nextExpectedIdx].focused,
        true,
        `DOM focus failed on seed ${seed} at step ${step}`,
      );
    }

    // Backward walk across all enabled items
    for (let step = 0; step < enabledIndices.length; step += 1) {
      const control = UiSegmented.SegmentedControl({
        value: activeValue,
        label: `Fuzz ${seed}`,
        options,
        onChange: (v) => {
          activeValue = v;
        },
      });
      const tabs = React.Children.toArray(control.props.children) as TestElement[];
      const curIdx = options.findIndex((o) => o.value === activeValue);
      tabs[curIdx].props.onKeyDown?.({
        key: "ArrowLeft",
        preventDefault: () => {},
        currentTarget: { parentElement: mockParent },
      });

      const curPos = enabledIndices.indexOf(curIdx);
      const prevExpectedPos = (curPos - 1 + enabledIndices.length) % enabledIndices.length;
      const prevExpectedIdx = enabledIndices[prevExpectedPos];
      assert.equal(
        activeValue,
        options[prevExpectedIdx].value,
        `Backward roving failed on seed ${seed} at step ${step}`,
      );
      assert.equal(
        elements[prevExpectedIdx].focused,
        true,
        `DOM focus failed on seed ${seed} at step ${step}`,
      );
    }
  }
});

// ============================================================================
// ADVERSARIAL SUITE 2: SegmentedField Form Semantics & Accessibility
// ============================================================================

test("ADVERSARIAL: SegmentedField fieldset disabled state and radio click/change propagation", () => {
  let formValue = "initial";
  const options = [
    { value: "opt1", label: "Option 1", badge: "New" },
    { value: "opt2", label: "Option 2", hint: "Recommended" },
    { value: "opt3", label: "Option 3", disabled: true },
  ];

  // Test fieldset disabled = true
  const disabledField = UiSegmented.SegmentedField({
    legend: "全局禁用字段",
    name: "global-disabled-field",
    value: "opt1",
    disabled: true,
    options,
    onChange: (val) => {
      formValue = val;
    },
  });

  assert.equal(disabledField.type, "fieldset");
  assert.equal(disabledField.props.disabled, true);

  const disabledOptionsContainer = findOptionsContainer(disabledField);
  const disabledLabels = React.Children.toArray(disabledOptionsContainer.props.children) as TestElement[];

  // All radio inputs inside disabled fieldset must have disabled truthy
  disabledLabels.forEach((labelElem) => {
    const radio = extractRadio(labelElem);
    assert.equal(Boolean(radio.props.disabled), true);
    // Triggering onChange on disabled input should NOT call onChange
    radio.props.onChange?.(dummyChangeEvent);
  });
  assert.equal(formValue, "initial", "Disabled fieldset must NOT trigger onChange");

  // Test individual option disabled = true
  const enabledField = UiSegmented.SegmentedField({
    legend: "部分禁用字段",
    name: "partial-field",
    value: "opt1",
    disabled: false,
    options,
    onChange: (val) => {
      formValue = val;
    },
  });

  const enabledOptionsContainer = findOptionsContainer(enabledField);
  const enabledLabels = React.Children.toArray(enabledOptionsContainer.props.children) as TestElement[];

  // Option 3 is disabled
  const radio3 = extractRadio(enabledLabels[2]);
  assert.equal(Boolean(radio3.props.disabled), true);
  radio3.props.onChange?.(dummyChangeEvent);
  assert.equal(formValue, "initial", "Disabled option must NOT trigger onChange");

  // Option 2 is enabled -> triggering onChange should succeed
  const radio2 = extractRadio(enabledLabels[1]);
  assert.equal(Boolean(radio2.props.disabled), false);
  radio2.props.onChange?.(dummyChangeEvent);
  assert.equal(formValue, "opt2", "Enabled option must trigger onChange with its value");
});

test("ADVERSARIAL: SegmentedField name fallback and legend vs label resolution", () => {
  // 1. Explicit name provided
  const fieldWithName = UiSegmented.SegmentedField({
    name: "custom_input_name",
    legend: "Legend Title",
    value: "val1",
    options: [{ value: "val1", label: "Val 1" }],
    onChange: () => {},
  });
  const container1 = findOptionsContainer(fieldWithName);
  const [label1] = React.Children.toArray(container1.props.children) as TestElement[];
  const radio1 = extractRadio(label1);
  assert.equal(radio1.props.name, "custom_input_name");

  // 2. Name omitted, string legend provided
  const fieldWithLegend = UiSegmented.SegmentedField({
    legend: "legend_name",
    value: "val1",
    options: [{ value: "val1", label: "Val 1" }],
    onChange: () => {},
  });
  const container2 = findOptionsContainer(fieldWithLegend);
  const [label2] = React.Children.toArray(container2.props.children) as TestElement[];
  const radio2 = extractRadio(label2);
  assert.equal(radio2.props.name, "legend_name");

  // 3. Name omitted, label provided
  const fieldWithLabel = UiSegmented.SegmentedField({
    label: "label_name",
    value: "val1",
    options: [{ value: "val1", label: "Val 1" }],
    onChange: () => {},
  });
  const container3 = findOptionsContainer(fieldWithLabel);
  const [label3] = React.Children.toArray(container3.props.children) as TestElement[];
  const radio3 = extractRadio(label3);
  assert.equal(radio3.props.name, "label_name");

  // 4. Name omitted, ReactNode legend provided -> fallback to "segmented-field"
  const fieldWithReactNode = UiSegmented.SegmentedField({
    legend: React.createElement("span", null, "ReactNode Legend"),
    value: "val1",
    options: [{ value: "val1", label: "Val 1" }],
    onChange: () => {},
  });
  const container4 = findOptionsContainer(fieldWithReactNode);
  const [label4] = React.Children.toArray(container4.props.children) as TestElement[];
  const radio4 = extractRadio(label4);
  assert.equal(radio4.props.name, "segmented-field");
});

test("ADVERSARIAL: SegmentedField description and hint fallback precedence", () => {
  // description takes precedence over hint
  const field = UiSegmented.SegmentedField({
    legend: "Precedence Test",
    description: "Primary Description",
    hint: "Secondary Hint",
    value: "v",
    options: [{ value: "v", label: "V" }],
    onChange: () => {},
  });
  const children = React.Children.toArray(field.props.children) as TestElement[];
  const descElem = children.find(
    (c) => c && c.type === "p" && c.props.className?.includes("text-zinc-500")
  );
  assert.ok(descElem);
  assert.equal(descElem.props.children, "Primary Description");

  // hint used when description is undefined
  const fieldWithHintOnly = UiSegmented.SegmentedField({
    legend: "Hint Only",
    hint: "Only Hint Provided",
    value: "v",
    options: [{ value: "v", label: "V" }],
    onChange: () => {},
  });
  const childrenHint = React.Children.toArray(fieldWithHintOnly.props.children) as TestElement[];
  const hintElem = childrenHint.find(
    (c) => c && c.type === "p" && c.props.className?.includes("text-zinc-500")
  );
  assert.ok(hintElem);
  assert.equal(hintElem.props.children, "Only Hint Provided");
});

test("ADVERSARIAL: SegmentedField error alert role and styling", () => {
  const errorField = UiSegmented.SegmentedField({
    legend: "评级",
    error: "必须选择一个评级选项",
    value: "none",
    options: [{ value: "1", label: "1" }],
    onChange: () => {},
  });
  const children = React.Children.toArray(errorField.props.children) as TestElement[];
  const errorElem = children.find((c) => c && c.props && c.props.role === "alert");
  assert.ok(errorElem, "Error must have role='alert'");
  assert.equal(errorElem.props.children, "必须选择一个评级选项");
  assert.ok(errorElem.props.className?.includes("text-rose-300"));
});

// ============================================================================
// ADVERSARIAL SUITE 3: Field Primitives Stress & HTML Attributes Forwarding
// ============================================================================

test("ADVERSARIAL: Field primitives pass through standard HTML attributes and aria-invalid", () => {
  // Input with aria-invalid, autoFocus, required, pattern
  const input = UiField.Input({
    type: "email",
    autoComplete: "email",
    required: true,
    pattern: "[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$",
    "aria-invalid": true,
    controlHeight: "sm",
  });
  assert.equal(input.props.type, "email");
  assert.equal(input.props.autoComplete, "email");
  assert.equal(input.props.required, true);
  assert.equal(input.props.pattern, "[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$");
  assert.equal(input.props["aria-invalid"], true);
  assert.ok(input.props.className.includes("h-8 px-3 text-xs"));
  assert.ok(input.props.className.includes("aria-invalid:border-rose-400/60"));

  // Textarea with spellCheck, maxLength, wrap
  const textarea = UiField.Textarea({
    maxLength: 500,
    wrap: "soft",
    controlHeight: "lg",
  });
  assert.equal(textarea.props.maxLength, 500);
  assert.equal(textarea.props.wrap, "soft");
  assert.ok(textarea.props.className.includes("min-h-32"));

  // Select with multiple, size
  const select = UiField.Select({
    size: 5,
    controlHeight: "xl",
  });
  assert.equal(select.props.size, 5);
  assert.ok(select.props.className.includes("h-12 px-4 text-base"));
});
