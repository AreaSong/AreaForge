import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {
  CapsuleRightSegment,
  SatelliteBubble,
  CapsuleLeftSegment,
  CapsuleCenterSegment,
} from "./dynamic-island-segments";
import {
  resolveDynamicIslandState,
  computeDynamicIslandStatePool,
  resolveDualTaskStates,
  type DynamicIslandActiveItem,
  type DynamicIslandCapsuleKind,
} from "./dynamic-island";
import type { StudySessionDto } from "@/lib/contracts";

function createMockSession(
  status: "running" | "paused" | "closing" | "completed",
  overrides?: Partial<StudySessionDto>
): StudySessionDto {
  return {
    id: "session-test-m2-challenger",
    subjectId: "subj-math-01",
    subjectName: "高等数学",
    activityKind: "STUDY",
    activityMode: "FREE_STUDY",
    reviewScheduleId: null,
    knowledgeRetestId: null,
    simulationExamId: null,
    taskId: null,
    taskTitle: null,
    taskStatus: null,
    syllabusNodeId: null,
    syllabusNodeTitle: null,
    knowledgePoints: [],
    status,
    startedAt: new Date(Date.now() - 1800 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
    pausedAt: status === "paused" ? new Date().toISOString() : null,
    endedAt: status === "completed" ? new Date().toISOString() : null,
    accumulatedPauseSeconds: 0,
    effectiveMinutes: 30,
    qualityScore: null,
    isEffective: null,
    understandingLevel: null,
    minimalOutput: null,
    nextAction: null,
    producedNote: false,
    producedMistake: false,
    isLowConversion: null,
    antiFakeReason: null,
    requiredOutput: null,
    closeoutVersion: 1,
    note: null,
    goalMinutes: 45,
    startSource: "SUBJECT_SHORTCUT",
    lowReasons: [],
    focusLevel: null,
    energyLevel: null,
    nextDisposition: null,
    clientDeviceId: null,
    clientDeviceLabel: null,
    lastHeartbeatAt: null,
    devicePresences: [],
    ...overrides,
  };
}

// Emulation of isInputElement logic to stress-test DOM element permutations
function isInputElementSimulated(el: {
  tagName?: string;
  isContentEditable?: boolean;
} | null): boolean {
  if (!el) return false;
  const tagName = el.tagName?.toUpperCase();
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  if (Boolean(el.isContentEditable)) {
    return true;
  }
  return false;
}

// Emulation of useDynamicIslandKeyboard event processing logic
interface DynamicIslandKeyboardState {
  isOpen: boolean;
  viewMode: string;
  query: string;
  focusedInput: boolean;
  blurredInput: boolean;
  preventedDefault: boolean;
}

function processKeyboardEvent(
  e: {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  },
  activeElement: { tagName?: string; isContentEditable?: boolean } | null,
  currentState: { isOpen: boolean; viewMode: string; query: string }
): {
  state: DynamicIslandKeyboardState;
  intercepted: boolean;
} {
  const resultState: DynamicIslandKeyboardState = {
    isOpen: currentState.isOpen,
    viewMode: currentState.viewMode,
    query: currentState.query,
    focusedInput: false,
    blurredInput: false,
    preventedDefault: false,
  };

  const isInput = isInputElementSimulated(activeElement);

  // 1. ⌘K or Ctrl+K (global penetration)
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    resultState.preventedDefault = true;
    resultState.isOpen = true;
    resultState.viewMode = "search";
    resultState.focusedInput = true;
    return { state: resultState, intercepted: true };
  }

  // 2. / (forward slash) when not inside input/textarea/select/editable
  if (e.key === "/" && !isInput && !currentState.isOpen) {
    resultState.preventedDefault = true;
    resultState.isOpen = true;
    resultState.viewMode = "search";
    resultState.focusedInput = true;
    return { state: resultState, intercepted: true };
  }

  // 3. Escape key collapses the dynamic island
  if (e.key === "Escape" && currentState.isOpen) {
    resultState.preventedDefault = true;
    resultState.isOpen = false;
    resultState.blurredInput = true;
    resultState.query = "";
    return { state: resultState, intercepted: true };
  }

  return { state: resultState, intercepted: false };
}

// ============================================================================
// CHALLENGER TEST SUITE: Keyboard Traps & Global Penetration
// ============================================================================

test("Challenger M2: '/' pressed inside text INPUT must NOT trigger command palette and MUST NOT prevent default", () => {
  const inputElements = [
    { tagName: "INPUT" },
    { tagName: "input" },
    { tagName: "INPUT", type: "text" },
    { tagName: "INPUT", type: "search" },
    { tagName: "INPUT", type: "password" },
    { tagName: "INPUT", type: "email" },
    { tagName: "INPUT", type: "number" },
  ];

  for (const el of inputElements) {
    const { state, intercepted } = processKeyboardEvent(
      { key: "/" },
      el,
      { isOpen: false, viewMode: "overview", query: "" }
    );

    assert.equal(intercepted, false, `Typing '/' inside ${JSON.stringify(el)} must not be intercepted`);
    assert.equal(state.isOpen, false, `Island must remain closed when typing '/' in ${JSON.stringify(el)}`);
    assert.equal(state.preventedDefault, false, `preventDefault must not be called when typing '/' in ${JSON.stringify(el)}`);
  }
});

test("Challenger M2: '/' pressed inside TEXTAREA must NOT trigger command palette and MUST NOT prevent default", () => {
  const textareas = [
    { tagName: "TEXTAREA" },
    { tagName: "textarea" },
  ];

  for (const el of textareas) {
    const { state, intercepted } = processKeyboardEvent(
      { key: "/" },
      el,
      { isOpen: false, viewMode: "overview", query: "" }
    );

    assert.equal(intercepted, false, "Typing '/' in textarea must not be intercepted");
    assert.equal(state.isOpen, false, "Island must remain closed");
    assert.equal(state.preventedDefault, false, "preventDefault must not be called");
  }
});

test("Challenger M2: '/' pressed inside SELECT or contenteditable elements must NOT trigger command palette", () => {
  const editableElements = [
    { tagName: "SELECT" },
    { tagName: "select" },
    { tagName: "DIV", isContentEditable: true },
    { tagName: "SPAN", isContentEditable: true },
    { tagName: "P", isContentEditable: true },
    { tagName: "SECTION", isContentEditable: true },
  ];

  for (const el of editableElements) {
    const { state, intercepted } = processKeyboardEvent(
      { key: "/" },
      el,
      { isOpen: false, viewMode: "overview", query: "" }
    );

    assert.equal(intercepted, false, `Typing '/' in editable ${JSON.stringify(el)} must not be intercepted`);
    assert.equal(state.isOpen, false);
    assert.equal(state.preventedDefault, false);
  }
});

test("Challenger M2: '/' pressed when focus is on non-input element (body, div, button) MUST trigger command palette", () => {
  const nonInputElements = [
    null,
    { tagName: "BODY" },
    { tagName: "DIV", isContentEditable: false },
    { tagName: "SPAN", isContentEditable: false },
    { tagName: "BUTTON" },
    { tagName: "MAIN" },
    { tagName: "A" },
  ];

  for (const el of nonInputElements) {
    const { state, intercepted } = processKeyboardEvent(
      { key: "/" },
      el,
      { isOpen: false, viewMode: "overview", query: "" }
    );

    assert.equal(intercepted, true, `Typing '/' on non-input ${JSON.stringify(el)} must trigger command palette`);
    assert.equal(state.isOpen, true, "Dynamic island must open");
    assert.equal(state.viewMode, "search", "View mode must switch to search");
    assert.equal(state.preventedDefault, true, "preventDefault must be called to avoid typing '/' into page");
    assert.equal(state.focusedInput, true, "Search input must receive focus");
  }
});

test("Challenger M2: '/' pressed when command palette is ALREADY OPEN does NOT re-intercept or preventDefault", () => {
  const { state, intercepted } = processKeyboardEvent(
    { key: "/" },
    { tagName: "INPUT" }, // focused on search input inside open command palette
    { isOpen: true, viewMode: "search", query: "" }
  );

  assert.equal(intercepted, false, "Typing '/' in active command palette search input must allow typing slash");
  assert.equal(state.isOpen, true, "Must stay open");
  assert.equal(state.preventedDefault, false, "Must not prevent user from typing slash in query");
});

test("Challenger M2: ⌘K or Ctrl+K inside input fields, textareas, contenteditable MUST trigger command palette", () => {
  const contexts = [
    { tagName: "INPUT" },
    { tagName: "TEXTAREA" },
    { tagName: "DIV", isContentEditable: true },
    { tagName: "BUTTON" },
    null,
  ];

  for (const el of contexts) {
    // 1. Meta + K (macOS ⌘K)
    const macResult = processKeyboardEvent(
      { key: "k", metaKey: true },
      el,
      { isOpen: false, viewMode: "overview", query: "" }
    );
    assert.equal(macResult.intercepted, true, "⌘K must penetrate input fields");
    assert.equal(macResult.state.isOpen, true);
    assert.equal(macResult.state.viewMode, "search");
    assert.equal(macResult.state.preventedDefault, true);

    // 2. Ctrl + K (Windows/Linux)
    const winResult = processKeyboardEvent(
      { key: "k", ctrlKey: true },
      el,
      { isOpen: false, viewMode: "overview", query: "" }
    );
    assert.equal(winResult.intercepted, true, "Ctrl+K must penetrate input fields");
    assert.equal(winResult.state.isOpen, true);
    assert.equal(winResult.state.viewMode, "search");
    assert.equal(winResult.state.preventedDefault, true);

    // 3. Uppercase 'K' support
    const upperResult = processKeyboardEvent(
      { key: "K", metaKey: true, shiftKey: true },
      el,
      { isOpen: false, viewMode: "overview", query: "" }
    );
    assert.equal(upperResult.intercepted, true, "⌘+Shift+K must also open command palette");
    assert.equal(upperResult.state.isOpen, true);
  }
});

test("Challenger M2: Escape key when search is ACTIVE collapses island and resets query", () => {
  const { state, intercepted } = processKeyboardEvent(
    { key: "Escape" },
    { tagName: "INPUT" },
    { isOpen: true, viewMode: "search", query: "高等数学" }
  );

  assert.equal(intercepted, true, "Escape must be intercepted when island is open");
  assert.equal(state.isOpen, false, "Island must collapse to capsule mode");
  assert.equal(state.query, "", "Query must be reset to empty");
  assert.equal(state.blurredInput, true, "Search input must blur");
  assert.equal(state.preventedDefault, true, "Escape event default must be prevented");
});

test("Challenger M2: Escape key when island is COLLAPSED is NOT intercepted and preserves page events", () => {
  const { state, intercepted } = processKeyboardEvent(
    { key: "Escape" },
    { tagName: "BODY" },
    { isOpen: false, viewMode: "overview", query: "" }
  );

  assert.equal(intercepted, false, "Escape must NOT be intercepted when island is already collapsed");
  assert.equal(state.isOpen, false);
  assert.equal(state.preventedDefault, false, "preventDefault must NOT be called on collapsed Escape");
});

// ============================================================================
// CHALLENGER TEST SUITE: Event Bubbling & Stop Propagation on Hover Actions
// ============================================================================

test("Challenger M2: Clicking [ ⏸ 暂停 ] hover button calls stopPropagation and does NOT expand island hub", () => {
  const session = createMockSession("running", { subjectName: "考研政治" });
  let pauseInvoked = false;
  let propagationStopped = false;
  let parentContainerClicked = false;

  // Simulate parent container click handler (Main Capsule onClick)
  const onParentCapsuleClick = () => {
    parentContainerClicked = true;
  };

  const rightSegment = CapsuleRightSegment({
    capsuleState: { kind: "live_session_running", session, elapsedSeconds: 1800 },
    isOpen: false,
    isPausing: false,
    onDirectPause: () => {
      pauseInvoked = true;
    },
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;

  assert.ok(rightSegment);
  const children = React.Children.toArray(rightSegment.props.children);
  const hoverContainer = children[1] as React.ReactElement<{ children?: React.ReactNode[] }>;
  const hoverButtons = React.Children.toArray(hoverContainer.props.children);
  const pauseButton = hoverButtons[0] as React.ReactElement<{
    onClick?: (e: { stopPropagation: () => void }) => void;
  }>;

  assert.ok(pauseButton, "Pause button must exist in hover micro-actions");

  // Fire click on the Pause button with stopPropagation emulation
  pauseButton.props.onClick?.({
    stopPropagation: () => {
      propagationStopped = true;
    },
  });

  // If stopPropagation was NOT called, the click would bubble to parent
  if (!propagationStopped) {
    onParentCapsuleClick();
  }

  assert.equal(propagationStopped, true, "Pause button MUST call e.stopPropagation()");
  assert.equal(pauseInvoked, true, "onDirectPause callback MUST be invoked");
  assert.equal(parentContainerClicked, false, "Parent capsule click MUST NOT be triggered (no hub expansion)");
});

test("Challenger M2: Clicking [ 🏁 收口 ] hover link calls stopPropagation, invokes closeout/drawer close, and does NOT expand hub", () => {
  const session = createMockSession("running", { subjectName: "数据结构" });
  let closeoutInvoked = false;
  let drawerCloseInvoked = false;
  let propagationStopped = false;
  let parentContainerClicked = false;

  const onParentCapsuleClick = () => {
    parentContainerClicked = true;
  };

  const rightSegment = CapsuleRightSegment({
    capsuleState: { kind: "live_session_running", session, elapsedSeconds: 1800 },
    isOpen: false,
    onDirectCloseout: () => {
      closeoutInvoked = true;
    },
    onCloseDrawer: () => {
      drawerCloseInvoked = true;
    },
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;

  assert.ok(rightSegment);
  const children = React.Children.toArray(rightSegment.props.children);
  const hoverContainer = children[1] as React.ReactElement<{ children?: React.ReactNode[] }>;
  const hoverButtons = React.Children.toArray(hoverContainer.props.children);
  const closeoutLink = hoverButtons[1] as React.ReactElement<{
    onClick?: (e: { stopPropagation: () => void }) => void;
  }>;

  assert.ok(closeoutLink, "Closeout link must exist in hover micro-actions");

  // Fire click on the Closeout link
  closeoutLink.props.onClick?.({
    stopPropagation: () => {
      propagationStopped = true;
    },
  });

  if (!propagationStopped) {
    onParentCapsuleClick();
  }

  assert.equal(propagationStopped, true, "Closeout link MUST call e.stopPropagation()");
  assert.equal(closeoutInvoked, true, "onDirectCloseout callback MUST be invoked");
  assert.equal(drawerCloseInvoked, true, "onCloseDrawer callback MUST be invoked");
  assert.equal(parentContainerClicked, false, "Parent capsule click MUST NOT be triggered");
});

test("Challenger M2: Clicking SatelliteBubble calls stopPropagation and does NOT trigger parent click", () => {
  let swappedKind: DynamicIslandCapsuleKind | null = null;
  let onSwapCalled = false;
  let propagationStopped = false;
  let parentContainerClicked = false;

  const bubble = SatelliteBubble({
    satelliteState: { kind: "evening_review_due" },
    onSwapFluidFocus: (kind) => {
      swappedKind = kind as DynamicIslandCapsuleKind;
    },
    onSwap: () => {
      onSwapCalled = true;
    },
  }) as React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }>;

  assert.ok(bubble);
  bubble.props.onClick?.({
    stopPropagation: () => {
      propagationStopped = true;
    },
  });

  if (!propagationStopped) {
    parentContainerClicked = true;
  }

  assert.equal(propagationStopped, true, "Satellite bubble click MUST call stopPropagation");
  assert.equal(swappedKind, "evening_review_due");
  assert.equal(onSwapCalled, true);
  assert.equal(parentContainerClicked, false, "Parent container MUST NOT be clicked");
});

test("Challenger M2: Clicking Paused state [ 继续 ] button calls stopPropagation and triggers onDirectResume", () => {
  const session = createMockSession("paused", { subjectName: "英语阅读" });
  let resumeInvoked = false;
  let propagationStopped = false;
  let parentContainerClicked = false;

  const rightSegment = CapsuleRightSegment({
    capsuleState: { kind: "activity_paused", session, elapsedSeconds: 1200 },
    isOpen: false,
    onDirectResume: () => {
      resumeInvoked = true;
    },
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;

  assert.ok(rightSegment);
  const children = React.Children.toArray(rightSegment.props.children);
  const resumeButton = children.find(
    (c) => React.isValidElement(c) && typeof (c.props as { onClick?: unknown }).onClick === "function"
  ) as React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }> | undefined;

  assert.ok(resumeButton, "Resume button must exist in paused right segment");

  resumeButton.props.onClick?.({
    stopPropagation: () => {
      propagationStopped = true;
    },
  });

  if (!propagationStopped) {
    parentContainerClicked = true;
  }

  assert.equal(propagationStopped, true, "Resume button MUST call stopPropagation");
  assert.equal(resumeInvoked, true, "onDirectResume MUST be invoked");
  assert.equal(parentContainerClicked, false);
});
