import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import {
  HubViewModeTabs,
  HubCommandPaletteList,
  DynamicIslandHub,
  normalizeHubTab,
  type HubViewMode,
  type DynamicIslandHubProps,
} from "./dynamic-island-hub";
import {
  getAuraStyles,
  getAuraThemeForStateKind,
  getDefaultTabForStateKind,
} from "./dynamic-island-glow";
import {
  isStateSuppressedOnRoute,
  computeDynamicIslandStatePool,
  resolveDualTaskStates,
} from "./dynamic-island-state-engine";
import type {
  DynamicIslandActiveItem,
  DynamicIslandAuraTheme,
  DynamicIslandCapsuleKind,
} from "./dynamic-island-types";
import { GLOBAL_COMMANDS } from "@/lib/navigation/command-palette";
import type { StudySessionDto } from "@/lib/contracts";

function createMockSession(
  status: "running" | "paused" | "closing" | "completed",
  overrides?: Partial<StudySessionDto>
): StudySessionDto {
  return {
    id: "session-test-m3-challenger",
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

function elementContainsText(element: React.ReactNode, text: string): boolean {
  if (!element) return false;
  if (typeof element === "string") return element.includes(text);
  if (typeof element === "number") return String(element).includes(text);
  if (Array.isArray(element)) {
    const joined = element
      .filter((c): c is string | number => typeof c === "string" || typeof c === "number")
      .map(String)
      .join("");
    if (joined.includes(text)) return true;
    return element.some((child) => elementContainsText(child, text));
  }
  if (React.isValidElement(element)) {
    if (typeof element.type === "function") {
      try {
        const rendered = (element.type as (props: Record<string, unknown>) => React.ReactNode)(
          element.props as Record<string, unknown>
        );
        if (elementContainsText(rendered, text)) return true;
      } catch {}
    }
    const props = element.props as Record<string, unknown> | null | undefined;
    if (!props) return false;
    for (const key of Object.keys(props)) {
      if (key === "children") {
        if (elementContainsText(props.children as React.ReactNode, text)) return true;
      } else if (typeof props[key] === "string" && (props[key] as string).includes(text)) {
        return true;
      }
    }
  }
  return false;
}

function loadSource(relativePath: string): string {
  const candidates = [
    path.resolve(__dirname, relativePath),
    path.resolve(__dirname, "..", relativePath),
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), "apps/web", relativePath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf-8");
    }
  }
  throw new Error(`Could not find source file for ${relativePath}`);
}

// ============================================================================
// 1. TAB NORMALIZATION ADVERSARIAL CHALLENGES
// ============================================================================

test("Challenger M3: normalizeHubTab with comprehensive canonical, legacy, and invalid permutations", () => {
  // Canonical identifiers
  assert.equal(normalizeHubTab("status"), "overview");
  assert.equal(normalizeHubTab("stopwatch"), "focus");
  assert.equal(normalizeHubTab("evening"), "closure");
  assert.equal(normalizeHubTab("search"), "search");

  // Legacy identifiers
  assert.equal(normalizeHubTab("overview"), "overview");
  assert.equal(normalizeHubTab("focus"), "focus");
  assert.equal(normalizeHubTab("closure"), "closure");

  // Nullish & falsy
  assert.equal(normalizeHubTab(null), "search");
  assert.equal(normalizeHubTab(undefined), "search");
  assert.equal(normalizeHubTab(""), "search");

  // Arbitrary & invalid strings
  const invalidInputs = [
    "dashboard",
    "settings",
    "timeline",
    "STATUS",
    "FOCUS",
    "EVENING",
    "SEARCH",
    "  status  ",
    "status/overview",
    "/focus",
    "overview_panel",
    "12345",
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "null",
    "undefined",
    "false",
    "true",
    "0",
    "NaN",
    "{}",
    "[]",
    "<script>alert(1)</script>",
    "'; DROP TABLE users; --",
  ];

  for (const input of invalidInputs) {
    assert.equal(
      normalizeHubTab(input),
      "search",
      `Invalid tab string "${input}" must safely normalize to fallback "search"`
    );
  }
});

test("Challenger M3: HubViewModeTabs renders cleanly under all legacy and invalid viewMode values", () => {
  const testModes: Array<string | null | undefined> = [
    "status",
    "stopwatch",
    "evening",
    "search",
    "overview",
    "focus",
    "closure",
    "invalid_tab",
    "",
    null,
    undefined,
    "__proto__",
  ];

  for (const mode of testModes) {
    let clickedMode: HubViewMode | null = null;
    const element = HubViewModeTabs({
      viewMode: mode as HubViewMode,
      onViewModeChange: (m) => {
        clickedMode = m;
      },
      activeStatesCount: 2,
      hasRunningSession: true,
      pendingConfirmationsCount: 3,
      eveningDue: true,
    }) as React.ReactElement<{ children?: React.ReactNode[] }>;

    assert.ok(element, `HubViewModeTabs must render when viewMode is "${mode}"`);
    const children = React.Children.toArray(element.props.children);
    assert.equal(children.length, 4, "Must always render exactly 4 mode tabs");

    // Inactive tabs have 'hover:bg-white/5', active tab does NOT have 'hover:bg-white/5'
    const activeTabs = children.filter((c) =>
      React.isValidElement(c) && !(c.props as { className?: string }).className?.includes("hover:bg-white/5")
    );
    assert.equal(
      activeTabs.length,
      1,
      `Exactly 1 tab must be active when viewMode is "${mode}" (resolved: ${normalizeHubTab(mode)})`
    );

    // Clicking any tab works
    const tabButtons = children as Array<React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }>>;
    tabButtons[0].props.onClick?.({ stopPropagation: () => {} });
    assert.equal(clickedMode, "search");
  }
});

test("Challenger M3: HubActivePanel renders matching sub-components for all canonical, legacy, and invalid modes", () => {
  const dummyState: DynamicIslandActiveItem = {
    id: "test-item-01",
    kind: "idle",
    priorityWeight: 0,
    title: "AreaForge",
    accentTone: "zinc",
  };

  const baseProps: DynamicIslandHubProps = {
    isOpen: true,
    viewMode: "search",
    onViewModeChange: () => {},
    onClose: () => {},
    activeStates: [dummyState],
    dominantState: dummyState,
    elapsedSeconds: 0,
    commands: GLOBAL_COMMANDS,
    selectedIndex: 0,
    onSelectIndex: () => {},
    onExecuteCommand: () => {},
    onDirectResume: () => {},
    pendingConfirmationsCount: 1,
    eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
  };

  // 1. "status" and "overview" -> Supervision Overview
  for (const mode of ["status", "overview"] as HubViewMode[]) {
    const hub = DynamicIslandHub({ ...baseProps, viewMode: mode });
    assert.ok(elementContainsText(hub, "督战系统一切就绪"));
  }

  // 2. "stopwatch" and "focus" -> Stopwatch Panel
  for (const mode of ["stopwatch", "focus"] as HubViewMode[]) {
    const hub = DynamicIslandHub({ ...baseProps, viewMode: mode });
    assert.ok(elementContainsText(hub, "当前未在专注学习中"));
  }

  // 3. "evening" and "closure" -> Confirmation & Closure Guide
  for (const mode of ["evening", "closure"] as HubViewMode[]) {
    const hub = DynamicIslandHub({ ...baseProps, viewMode: mode });
    assert.ok(elementContainsText(hub, "晚间收口指引"));
    assert.ok(elementContainsText(hub, "待确认中心决策"));
  }

  // 4. "search", invalid, null, undefined -> Command Palette List
  for (const mode of ["search", "bogus_mode", "", null, undefined] as HubViewMode[]) {
    const hub = DynamicIslandHub({ ...baseProps, viewMode: mode });
    assert.ok(elementContainsText(hub, "打开今日行动") || elementContainsText(hub, "未找到匹配的结果或命令"));
  }
});

// ============================================================================
// 2. RAPID SWITCHING & CHANGING DOMINANT STATES CHALLENGES
// ============================================================================

test("Challenger M3: Rapid tab switching loop maintains consistent view mode state and event propagation", () => {
  const switchHistory: HubViewMode[] = [];
  const sequence: HubViewMode[] = [
    "search",
    "overview",
    "focus",
    "closure",
    "status",
    "stopwatch",
    "evening",
    "search",
    "focus",
    "closure",
  ];

  let currentMode: HubViewMode = "search";
  const onViewModeChange = (mode: HubViewMode) => {
    switchHistory.push(mode);
    currentMode = mode;
  };

  const tabIndexMap: Record<string, number> = {
    search: 0,
    overview: 1,
    status: 1,
    focus: 2,
    stopwatch: 2,
    closure: 3,
    evening: 3,
  };

  for (const targetMode of sequence) {
    const tabsElement = HubViewModeTabs({
      viewMode: currentMode,
      onViewModeChange,
      activeStatesCount: 1,
      hasRunningSession: false,
      pendingConfirmationsCount: 0,
      eveningDue: false,
    }) as React.ReactElement<{ children?: React.ReactNode[] }>;

    const children = React.Children.toArray(tabsElement.props.children) as Array<
      React.ReactElement<{
        onClick?: (e: { stopPropagation: () => void }) => void;
      }>
    >;

    const targetIdx = tabIndexMap[targetMode] ?? 0;
    const targetButton = children[targetIdx];
    assert.ok(targetButton, `Button at index ${targetIdx} for ${targetMode} must exist`);

    let stopped = false;
    targetButton.props.onClick?.({
      stopPropagation: () => {
        stopped = true;
      },
    });
    assert.equal(stopped, true, "Every tab click must stop propagation");
  }

  assert.equal(switchHistory.length, sequence.length);
  assert.equal(switchHistory[switchHistory.length - 1], "closure");
});

test("Challenger M3: Dynamic dominant state transitions update chromatic theme and aura classes accurately", () => {
  const session = createMockSession("running", { subjectName: "操作系统" });
  const pausedSession = createMockSession("paused", { subjectName: "计算机网络" });

  const testCases: Array<{
    dominantItem: DynamicIslandActiveItem;
    expectedTheme: DynamicIslandAuraTheme;
    expectedDefaultTab: string;
    expectedTabClass: string;
    expectedBorderClass: string;
    expectedSelectedCmdClass: string;
    expectedJumpTagClass: string;
  }> = [
    // 1. Indigo (Evening Review Due)
    {
      dominantItem: {
        id: "d-evening",
        kind: "evening_review_due",
        priorityWeight: 600,
        title: "晚间复盘待收口",
        accentTone: "indigo",
        reviewHref: "/roadmap/reviews/daily",
      },
      expectedTheme: "indigo",
      expectedDefaultTab: "evening",
      expectedTabClass: "bg-indigo-500/20",
      expectedBorderClass: "border-indigo-500/40",
      expectedSelectedCmdClass: "bg-indigo-500/15",
      expectedJumpTagClass: "text-indigo-400",
    },
    // 2. Amber (Recovery Active)
    {
      dominantItem: {
        id: "d-recovery",
        kind: "recovery_active",
        priorityWeight: 700,
        title: "精力恢复模式",
        stage: 1,
        targetMinutes: 30,
        accentTone: "amber",
      },
      expectedTheme: "amber",
      expectedDefaultTab: "status",
      expectedTabClass: "bg-amber-500/20",
      expectedBorderClass: "border-amber-500/40",
      expectedSelectedCmdClass: "bg-amber-500/15",
      expectedJumpTagClass: "text-amber-400",
    },
    // 3. Amber (Sync Issue)
    {
      dominantItem: {
        id: "d-sync",
        kind: "sync_issue",
        priorityWeight: 500,
        title: "离线待对账",
        syncState: "deferred",
        accentTone: "amber",
      },
      expectedTheme: "amber",
      expectedDefaultTab: "status",
      expectedTabClass: "bg-amber-500/20",
      expectedBorderClass: "border-amber-500/40",
      expectedSelectedCmdClass: "bg-amber-500/15",
      expectedJumpTagClass: "text-amber-400",
    },
    // 4. Amber (Confirmations Pending)
    {
      dominantItem: {
        id: "d-confirm",
        kind: "confirmations_pending",
        priorityWeight: 400,
        title: "3 项待确认",
        pendingConfirmationsCount: 3,
        accentTone: "amber",
      },
      expectedTheme: "amber",
      expectedDefaultTab: "status",
      expectedTabClass: "bg-amber-500/20",
      expectedBorderClass: "border-amber-500/40",
      expectedSelectedCmdClass: "bg-amber-500/15",
      expectedJumpTagClass: "text-amber-400",
    },
    // 5. Teal (Running Session)
    {
      dominantItem: {
        id: "d-running",
        kind: "live_session_running",
        priorityWeight: 1000,
        title: "操作系统",
        session,
        accentTone: "teal",
      },
      expectedTheme: "teal",
      expectedDefaultTab: "stopwatch",
      expectedTabClass: "bg-teal-500/20",
      expectedBorderClass: "border-teal-500/40",
      expectedSelectedCmdClass: "bg-teal-500/15",
      expectedJumpTagClass: "text-teal-400",
    },
    // 6. Teal (Paused Session)
    {
      dominantItem: {
        id: "d-paused",
        kind: "activity_paused",
        priorityWeight: 800,
        title: "计算机网络",
        session: pausedSession,
        accentTone: "amber",
      },
      expectedTheme: "teal",
      expectedDefaultTab: "stopwatch",
      expectedTabClass: "bg-teal-500/20",
      expectedBorderClass: "border-teal-500/40",
      expectedSelectedCmdClass: "bg-teal-500/15",
      expectedJumpTagClass: "text-teal-400",
    },
    // 7. Silver (Idle / Search)
    {
      dominantItem: {
        id: "d-idle",
        kind: "idle",
        priorityWeight: 0,
        title: "AreaForge",
        accentTone: "zinc",
      },
      expectedTheme: "silver",
      expectedDefaultTab: "search",
      expectedTabClass: "bg-white/10",
      expectedBorderClass: "border-white/15",
      expectedSelectedCmdClass: "bg-white/10",
      expectedJumpTagClass: "text-zinc-300",
    },
  ];

  for (const tc of testCases) {
    const resolvedTheme = getAuraThemeForStateKind(tc.dominantItem.kind);
    assert.equal(resolvedTheme, tc.expectedTheme);

    const defaultTab = getDefaultTabForStateKind(tc.dominantItem.kind);
    assert.equal(defaultTab, tc.expectedDefaultTab);

    const styles = getAuraStyles(resolvedTheme);
    assert.ok(
      styles.tabActiveClass.includes(tc.expectedTabClass),
      `Tab class for ${tc.expectedTheme} must include ${tc.expectedTabClass}`
    );
    assert.ok(
      styles.hubBorderClass.includes(tc.expectedBorderClass),
      `Hub border class for ${tc.expectedTheme} must include ${tc.expectedBorderClass}`
    );

    // Verify HubViewModeTabs styling
    const tabsElement = HubViewModeTabs({
      viewMode: defaultTab as HubViewMode,
      onViewModeChange: () => {},
      activeStatesCount: 1,
      hasRunningSession: tc.dominantItem.kind === "live_session_running",
      pendingConfirmationsCount: tc.dominantItem.kind === "confirmations_pending" ? 3 : 0,
      eveningDue: tc.dominantItem.kind === "evening_review_due",
      dominantState: tc.dominantItem,
    }) as React.ReactElement<{ children?: React.ReactNode[] }>;

    const children = React.Children.toArray(tabsElement.props.children) as Array<
      React.ReactElement<{ className?: string }>
    >;
    const activeTab = children.find((c) => c.props.className?.includes(tc.expectedTabClass));
    assert.ok(activeTab, `Active tab for ${tc.dominantItem.kind} must receive ${tc.expectedTabClass}`);

    // Verify Command Palette Chromatic Theming
    const cmdListElement = HubCommandPaletteList({
      commands: GLOBAL_COMMANDS.slice(0, 1),
      selectedIndex: 0,
      onSelectIndex: () => {},
      onExecuteCommand: () => {},
      auraTheme: tc.expectedTheme,
    }) as React.ReactElement<{ children?: React.ReactNode[] }>;

    const cmdItems = React.Children.toArray(cmdListElement.props.children) as Array<
      React.ReactElement<{ className?: string; children?: React.ReactNode[] }>
    >;
    assert.ok(cmdItems[0].props.className?.includes(tc.expectedSelectedCmdClass));

    const jumpTag = (React.Children.toArray(cmdItems[0].props.children) as Array<React.ReactElement<{ className?: string }>>)[1];
    assert.ok(jumpTag.props.className?.includes(tc.expectedJumpTagClass));
  }
});

// ============================================================================
// 3. PATHNAME PROP VARIATIONS & ROUTE CONTEXT SUPPRESSION
// ============================================================================

test("Challenger M3: isStateSuppressedOnRoute against complete pathname matrix", () => {
  const stopwatchKinds: DynamicIslandCapsuleKind[] = [
    "live_session_running",
    "live_session_closing",
    "activity_paused",
  ];
  const recoveryKind: DynamicIslandCapsuleKind = "recovery_active";
  const eveningKind: DynamicIslandCapsuleKind = "evening_review_due";
  const allKinds: DynamicIslandCapsuleKind[] = [...stopwatchKinds, recoveryKind, eveningKind];

  // 1. Falsy & Neutral paths -> 0 suppression across all kinds
  const neutralPaths = [
    undefined,
    null,
    "",
    "   ",
    "/",
    "/settings",
    "/syllabus",
    "/knowledge",
    "/analytics",
    "/reports",
    "/simulation",
    "/today-archive",
    "/focus-special",
    "/roadmap/reviews-old",
  ];

  for (const path of neutralPaths) {
    for (const kind of allKinds) {
      assert.equal(
        isStateSuppressedOnRoute(kind, path),
        false,
        `State ${kind} must NOT be suppressed on neutral route "${path}"`
      );
    }
  }

  // 2. /focus paths -> suppresses stopwatch kinds ONLY
  const focusPaths = [
    "/focus",
    "/focus/",
    "/focus/subj-math-01",
    "/focus/deep/nested/view",
    "/focus?timer=1&mode=focus#timer-canvas",
    "//focus",
    "///focus/sub",
    "  /focus  ",
  ];

  for (const path of focusPaths) {
    for (const kind of stopwatchKinds) {
      assert.equal(
        isStateSuppressedOnRoute(kind, path),
        true,
        `Stopwatch state ${kind} MUST be suppressed on focus route "${path}"`
      );
    }
    assert.equal(
      isStateSuppressedOnRoute(recoveryKind, path),
      false,
      `Recovery state must NOT be suppressed on focus route "${path}"`
    );
    assert.equal(
      isStateSuppressedOnRoute(eveningKind, path),
      false,
      `Evening review state must NOT be suppressed on focus route "${path}"`
    );
  }

  // 3. /today paths -> suppresses recovery kind ONLY
  const todayPaths = [
    "/today",
    "/today/",
    "/today/actions",
    "/today/overview",
    "/today?date=2026-08-27#actions",
    "//today",
    "  /today  ",
  ];

  for (const path of todayPaths) {
    assert.equal(
      isStateSuppressedOnRoute(recoveryKind, path),
      true,
      `Recovery state MUST be suppressed on today route "${path}"`
    );
    for (const kind of stopwatchKinds) {
      assert.equal(
        isStateSuppressedOnRoute(kind, path),
        false,
        `Stopwatch state ${kind} must NOT be suppressed on today route "${path}"`
      );
    }
    assert.equal(
      isStateSuppressedOnRoute(eveningKind, path),
      false,
      `Evening review state must NOT be suppressed on today route "${path}"`
    );
  }

  // 4. /roadmap/reviews paths -> suppresses evening review kind ONLY
  const reviewPaths = [
    "/roadmap/reviews",
    "/roadmap/reviews/",
    "/roadmap/reviews/daily",
    "/roadmap/reviews/weekly",
    "/roadmap/reviews/monthly",
    "/roadmap/reviews?mode=quick#notes",
    "//roadmap/reviews/daily",
    "  /roadmap/reviews  ",
  ];

  for (const path of reviewPaths) {
    assert.equal(
      isStateSuppressedOnRoute(eveningKind, path),
      true,
      `Evening review state MUST be suppressed on review route "${path}"`
    );
    for (const kind of stopwatchKinds) {
      assert.equal(
        isStateSuppressedOnRoute(kind, path),
        false,
        `Stopwatch state ${kind} must NOT be suppressed on review route "${path}"`
      );
    }
    assert.equal(
      isStateSuppressedOnRoute(recoveryKind, path),
      false,
      `Recovery state must NOT be suppressed on review route "${path}"`
    );
  }
});

test("Challenger M3: computeDynamicIslandStatePool with multi-state pool under pathname routing transitions", () => {
  const session = createMockSession("running", { subjectName: "高等数学" });

  const baseInput = {
    activeSession: session,
    recovery: { active: true, stage: 1, targetMinutes: 30 },
    eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
    pendingConfirmationsCount: 2,
    elapsedSeconds: 1200,
  };

  // Scenario A: Neutral route ("/settings" or null) -> All 4 states active
  const poolSettings = computeDynamicIslandStatePool({ ...baseInput, pathname: "/settings" });
  assert.equal(poolSettings.activeStates.length, 4);
  assert.equal(poolSettings.dominantState.kind, "live_session_running");
  assert.equal(poolSettings.hasConcurrency, true);

  const dualSettings = resolveDualTaskStates(poolSettings.activeStates, "/settings");
  assert.equal(dualSettings.dominant.kind, "live_session_running");
  assert.equal(dualSettings.satellite?.kind, "recovery_active");

  // Scenario B: Navigating to "/focus" -> Stopwatch is suppressed!
  // Recovery (P3: 700) rises to become Dominant; Evening Review (P4: 600) becomes Satellite Bubble
  const poolFocus = computeDynamicIslandStatePool({ ...baseInput, pathname: "/focus" });
  assert.equal(poolFocus.activeStates.length, 3);
  assert.equal(poolFocus.dominantState.kind, "recovery_active");
  assert.equal(poolFocus.activeStates.some((s) => s.kind === "live_session_running"), false);

  const dualFocus = resolveDualTaskStates(poolFocus.activeStates, "/focus");
  assert.equal(dualFocus.dominant.kind, "recovery_active");
  assert.equal(dualFocus.satellite?.kind, "evening_review_due");

  // Scenario C: Navigating to "/today" -> Recovery is suppressed!
  // Running session (P0: 1000) remains Dominant; Evening Review (P4: 600) rises to become Satellite Bubble
  const poolToday = computeDynamicIslandStatePool({ ...baseInput, pathname: "/today" });
  assert.equal(poolToday.activeStates.length, 3);
  assert.equal(poolToday.dominantState.kind, "live_session_running");
  assert.equal(poolToday.activeStates.some((s) => s.kind === "recovery_active"), false);

  const dualToday = resolveDualTaskStates(poolToday.activeStates, "/today");
  assert.equal(dualToday.dominant.kind, "live_session_running");
  assert.equal(dualToday.satellite?.kind, "evening_review_due");

  // Scenario D: Navigating to "/roadmap/reviews/daily" -> Evening Review is suppressed!
  // Running session (P0: 1000) is Dominant; Recovery (P3: 700) is Satellite Bubble
  const poolReviews = computeDynamicIslandStatePool({ ...baseInput, pathname: "/roadmap/reviews/daily" });
  assert.equal(poolReviews.activeStates.length, 3);
  assert.equal(poolReviews.dominantState.kind, "live_session_running");
  assert.equal(poolReviews.activeStates.some((s) => s.kind === "evening_review_due"), false);

  const dualReviews = resolveDualTaskStates(poolReviews.activeStates, "/roadmap/reviews/daily");
  assert.equal(dualReviews.dominant.kind, "live_session_running");
  assert.equal(dualReviews.satellite?.kind, "recovery_active");

  // Scenario E: Only single state active matching the current page -> Clean suppression to IDLE search capsule
  const singleFocusInput = { activeSession: session, elapsedSeconds: 1200, pathname: "/focus" };
  const poolSingleFocus = computeDynamicIslandStatePool(singleFocusInput);
  assert.equal(poolSingleFocus.activeStates.length, 0);
  assert.equal(poolSingleFocus.dominantState.kind, "idle");
  assert.equal(poolSingleFocus.hasConcurrency, false);

  const dualSingleFocus = resolveDualTaskStates(poolSingleFocus.activeStates, "/focus");
  assert.equal(dualSingleFocus.dominant.kind, "idle");
  assert.equal(dualSingleFocus.satellite, null);
});

// ============================================================================
// 4. SHELL PLUMBING & INTERFACE CONTRACTS
// ============================================================================

test("Challenger M3: Source verification of GlobalTopBar and AppShell prop plumbing", () => {
  const appShellSource = loadSource("components/app-shell.tsx");
  const topBarSource = loadSource("components/global-top-bar.tsx");
  const topBarAliasSource = loadSource("components/global-topbar.tsx");
  const islandSource = loadSource("components/dynamic-island.tsx");
  const hubSource = loadSource("components/dynamic-island-hub.tsx");

  // AppShell must extract pathname and pass it to GlobalTopBar
  assert.match(appShellSource, /const\s+pathname\s*=\s*usePathname\(\)/);
  assert.match(appShellSource, /<GlobalTopBar[\s\S]*pathname=\{pathname\}/);

  // GlobalTopBarProps must include pathname?: string | null
  assert.match(topBarSource, /pathname\?: string \| null/);
  assert.match(topBarSource, /<DynamicIsland[\s\S]*pathname=\{props\.pathname\}/);
  assert.match(topBarSource, /<GlobalConfirmationCenter[\s\S]*pathname=\{props\.pathname \?\? ""\}/);

  // global-topbar.tsx must re-export global-top-bar.tsx
  assert.match(topBarAliasSource, /export\s+\*\s+from\s+["']\.\/global-top-bar["']/);

  // DynamicIsland must accept pathname and forward to state pool & hubProps
  assert.match(islandSource, /pathname\?: string \| null/);
  assert.match(islandSource, /computeDynamicIslandStatePool\(\{[\s\S]*pathname:\s*props\.pathname/);
  assert.match(islandSource, /resolveDualTaskStates\(pool\.activeStates,\s*props\.pathname/);
  assert.match(islandSource, /hubProps=\{\{[\s\S]*pathname:\s*props\.pathname/);

  // DynamicIslandHubProps must accept pathname?: string | null, auraTheme, defaultTab
  assert.match(hubSource, /pathname\?: string \| null/);
  assert.match(hubSource, /auraTheme\?: DynamicIslandAuraTheme/);
  assert.match(hubSource, /defaultTab\?: DynamicIslandHubTab/);
  assert.match(hubSource, /export const MorphingFloatingHub\s*=\s*DynamicIslandHub/);
});
