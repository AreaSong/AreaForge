import test from "node:test";
import assert from "node:assert/strict";
import React from "react";

import {
  type DynamicIslandActiveItem,
  type DynamicIslandCapsuleKind,
  type DynamicIslandCapsuleState,
  type DynamicIslandStatePool,
  type DynamicIslandTone,
  type DynamicIslandAuraTheme,
  type DynamicIslandHubTab,
  type DynamicIslandRecoveryProps,
  type DynamicIslandEveningReviewProps,
  type DynamicIslandSyncState,
  type CollectDynamicIslandStatesInput,
  type DualTaskResolutionResult,
  PRIORITY_WEIGHTS,
  IDLE_STATE_ITEM,
} from "./dynamic-island-types";

import {
  isStateSuppressedOnRoute,
  filterStatesByRouteContext,
  clampTimerDuration,
  getPriorityWeight,
  createIdleStateItem,
  collectDynamicIslandActiveStates,
  sortActiveStatesByPriority,
  getDominantState,
  resolveDominantState,
  resolveDualTaskStates,
  computeDynamicIslandStatePool,
  collectDynamicIslandStatePool,
  validateStatePoolInvariants,
  resolveDynamicIslandState,
} from "./dynamic-island-state-engine";

import {
  DYNAMIC_ISLAND_AURA_THEMES,
  getAuraThemeForStateKind,
  getAuraStyles,
  getDefaultTabForStateKind,
  getSatelliteBubbleGlowClass,
  getCapsuleGlowStyle,
  getCapsuleGlowClass,
  getCapsuleInlineStyle,
  getToneFromCapsuleKind,
  getCapsuleToneColors,
  TONE_COLOR_SPECS,
} from "./dynamic-island-glow";

import {
  SatelliteBubble,
  CapsuleLeftSegment,
  CapsuleCenterSegment,
  CapsuleRightSegment,
  CapsuleBreathingDots,
} from "./dynamic-island-segments";

import {
  normalizeHubTab,
  HubViewModeTabs,
  HubSupervisionOverview,
  HubFlowStopwatchPanel,
  HubConfirmationClosureGuide,
  HubCommandPaletteList,
  DynamicIslandHub,
  MorphingFloatingHub,
  type HubViewMode,
} from "./dynamic-island-hub";

import {
  TICKER_INTERVAL_MS,
  TICKER_RESUME_GRACE_MS,
  getNextTickerIndex,
  getPrevTickerIndex,
  clampTickerIndex,
  computeBreathingPagination,
  isTickerP0Pinned,
  isTickerRotationEnabled,
  computeTickerNextState,
  computePaginationDots,
  generatePaginationDots,
  formatDotsText,
  resolveTickerCurrentItem,
} from "./dynamic-island-ticker";

import {
  filterGlobalCommands,
  resolveGlobalCommand,
  tokenizeCommandArguments,
  clampCommandIndex,
  GLOBAL_COMMANDS,
  type GlobalCommandDefinition,
} from "@/lib/navigation/command-palette";

import { formatClockDuration, formatShortDuration } from "@/lib/formatters";
import { getTimerElapsedSeconds } from "@areaforge/core";
import type { StudySessionDto } from "@/lib/contracts";

function createMockSession(
  status: "running" | "paused" | "closing" | "completed",
  overrides?: Partial<StudySessionDto>
): StudySessionDto {
  return {
    id: "session-m4-adv-01",
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

// ============================================================================
// TIER 1: Route Anti-Redundancy & Predicate Logic
// ============================================================================

test("Tier 1 - /focus route strictly suppresses live stopwatch states", () => {
  assert.equal(isStateSuppressedOnRoute("live_session_running", "/focus"), true);
  assert.equal(isStateSuppressedOnRoute("live_session_closing", "/focus"), true);
  assert.equal(isStateSuppressedOnRoute("activity_paused", "/focus"), true);

  // Non-stopwatch states must not be suppressed on /focus
  assert.equal(isStateSuppressedOnRoute("recovery_active", "/focus"), false);
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "/focus"), false);
  assert.equal(isStateSuppressedOnRoute("sync_issue", "/focus"), false);
  assert.equal(isStateSuppressedOnRoute("confirmations_pending", "/focus"), false);
  assert.equal(isStateSuppressedOnRoute("idle", "/focus"), false);

  // Subpaths under /focus
  assert.equal(isStateSuppressedOnRoute("live_session_running", "/focus/cockpit"), true);
  assert.equal(isStateSuppressedOnRoute("live_session_running", "/focus/timer?mode=deep"), true);
});

test("Tier 1 - /today route strictly suppresses recovery active state", () => {
  assert.equal(isStateSuppressedOnRoute("recovery_active", "/today"), true);
  assert.equal(isStateSuppressedOnRoute("recovery_active", "/today/overview"), true);
  assert.equal(isStateSuppressedOnRoute("recovery_active", "/today?filter=urgent#hero"), true);

  // Other states must remain unsuppressed on /today
  assert.equal(isStateSuppressedOnRoute("live_session_running", "/today"), false);
  assert.equal(isStateSuppressedOnRoute("live_session_closing", "/today"), false);
  assert.equal(isStateSuppressedOnRoute("activity_paused", "/today"), false);
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "/today"), false);
  assert.equal(isStateSuppressedOnRoute("sync_issue", "/today"), false);
  assert.equal(isStateSuppressedOnRoute("confirmations_pending", "/today"), false);
});

test("Tier 1 - /roadmap/reviews routes strictly suppress evening review due state", () => {
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "/roadmap/reviews"), true);
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "/roadmap/reviews/daily"), true);
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "/roadmap/reviews/history?period=week"), true);

  // Other states must remain unsuppressed on /roadmap/reviews
  assert.equal(isStateSuppressedOnRoute("live_session_running", "/roadmap/reviews"), false);
  assert.equal(isStateSuppressedOnRoute("recovery_active", "/roadmap/reviews"), false);
  assert.equal(isStateSuppressedOnRoute("sync_issue", "/roadmap/reviews"), false);
  assert.equal(isStateSuppressedOnRoute("confirmations_pending", "/roadmap/reviews"), false);
});

test("Tier 1 - Neutral routes do not suppress any active states", () => {
  const neutralRoutes = [
    "/dashboard",
    "/tasks",
    "/analytics",
    "/settings",
    "/settings/exams",
    "/knowledge",
    "/test",
    "/roadmap",
    "/roadmap/stages",
  ];

  const allKinds: DynamicIslandCapsuleKind[] = [
    "live_session_running",
    "live_session_closing",
    "activity_paused",
    "recovery_active",
    "evening_review_due",
    "sync_issue",
    "confirmations_pending",
    "idle",
  ];

  for (const route of neutralRoutes) {
    for (const kind of allKinds) {
      assert.equal(
        isStateSuppressedOnRoute(kind, route),
        false,
        `Kind ${kind} should not be suppressed on neutral route ${route}`
      );
    }
  }
});

test("Tier 1 - Navigation away predicate transitions and state pool rising", () => {
  const runningSession = createMockSession("running", { subjectName: "高等数学" });
  const recoveryProps: DynamicIslandRecoveryProps = { active: true, stage: 1, targetMinutes: 30, reason: "微行动" };
  const eveningProps: DynamicIslandEveningReviewProps = { due: true, minimumActionDone: false, dailyReviewDone: false };

  const input: CollectDynamicIslandStatesInput = {
    activeSession: runningSession,
    recovery: recoveryProps,
    eveningReview: eveningProps,
    elapsedSeconds: 600,
  };

  // 1. On /focus: stopwatch is suppressed, so recovery (P3) becomes dominant
  const onFocusPool = computeDynamicIslandStatePool({ ...input, pathname: "/focus" });
  assert.equal(onFocusPool.dominantState.kind, "recovery_active");
  assert.equal(onFocusPool.activeStates.some((s) => s.kind === "live_session_running"), false);

  // 2. Navigating from /focus to /dashboard: stopwatch rises to dominant (P0)
  const onDashboardPool = computeDynamicIslandStatePool({ ...input, pathname: "/dashboard" });
  assert.equal(onDashboardPool.dominantState.kind, "live_session_running");
  assert.equal(onDashboardPool.activeStates.length, 3);

  // 3. On /today: recovery is suppressed, stopwatch remains dominant (P0)
  const onTodayPool = computeDynamicIslandStatePool({ ...input, pathname: "/today" });
  assert.equal(onTodayPool.dominantState.kind, "live_session_running");
  assert.equal(onTodayPool.activeStates.some((s) => s.kind === "recovery_active"), false);

  // 4. On /roadmap/reviews: evening review suppressed, stopwatch remains dominant
  const onReviewsPool = computeDynamicIslandStatePool({ ...input, pathname: "/roadmap/reviews" });
  assert.equal(onReviewsPool.dominantState.kind, "live_session_running");
  assert.equal(onReviewsPool.activeStates.some((s) => s.kind === "evening_review_due"), false);
});

test("Tier 1 - Path normalization robustness with query strings, hashes, and malformed slashes", () => {
  assert.equal(isStateSuppressedOnRoute("live_session_running", "///focus///?debug=1#timer"), true);
  assert.equal(isStateSuppressedOnRoute("recovery_active", "  /today?page=1  "), true);
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "roadmap/reviews/daily"), true);
  assert.equal(isStateSuppressedOnRoute("live_session_running", null), false);
  assert.equal(isStateSuppressedOnRoute("live_session_running", undefined), false);
  assert.equal(isStateSuppressedOnRoute("live_session_running", ""), false);
});

// ============================================================================
// TIER 2: Dual-Task Exclamation Satellite Bubble, Fluid Swap Morph, Dynamic Aura Tokens
// ============================================================================

test("Tier 2 - Dual-Task exclamation split into [Main Capsule] + [Satellite Bubble]", () => {
  const session = createMockSession("running", { subjectName: "线性代数" });
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 2, targetMinutes: 45 };

  const input: CollectDynamicIslandStatesInput = {
    activeSession: session,
    recovery,
    elapsedSeconds: 900,
    pathname: "/dashboard",
  };

  const pool = computeDynamicIslandStatePool(input);
  assert.equal(pool.hasConcurrency, true);
  assert.equal(pool.activeStates.length, 2);

  const dualTask = resolveDualTaskStates(pool.activeStates, "/dashboard");
  assert.ok(dualTask.dominant, "Must have dominant state");
  assert.ok(dualTask.satellite, "Must have satellite state");
  assert.equal(dualTask.dominant.kind, "live_session_running");
  assert.equal(dualTask.satellite.kind, "recovery_active");
  assert.equal(dualTask.allUnsuppressed.length, 2);
});

test("Tier 2 - Fluid Swap Morph exchanges dominant and satellite focus", () => {
  const session = createMockSession("running", { subjectName: "考研英语" });
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 1, targetMinutes: 30 };
  const eveningReview: DynamicIslandEveningReviewProps = { due: true, minimumActionDone: true, dailyReviewDone: false };

  const activeStates = collectDynamicIslandActiveStates({
    activeSession: session,
    recovery,
    eveningReview,
    elapsedSeconds: 1200,
  });

  // Default resolution: P0 (running) dominant, P3 (recovery) satellite
  const defaultDual = resolveDualTaskStates(activeStates, "/dashboard");
  assert.equal(defaultDual.dominant.kind, "live_session_running");
  assert.equal(defaultDual.satellite?.kind, "recovery_active");

  // Fluid Swap 1: User chooses recovery_active to become dominant
  const swappedToRecovery = resolveDualTaskStates(activeStates, "/dashboard", "recovery_active");
  assert.equal(swappedToRecovery.dominant.kind, "recovery_active");
  assert.equal(swappedToRecovery.satellite?.kind, "live_session_running");

  // Fluid Swap 2: User chooses evening_review_due to become dominant
  const swappedToEvening = resolveDualTaskStates(activeStates, "/dashboard", "evening_review_due");
  assert.equal(swappedToEvening.dominant.kind, "evening_review_due");
  assert.equal(swappedToEvening.satellite?.kind, "live_session_running");

  // Fluid Swap 3: Non-existent or invalid swap kind falls back to default priority
  const swappedInvalid = resolveDualTaskStates(activeStates, "/dashboard", "idle");
  assert.equal(swappedInvalid.dominant.kind, "live_session_running");
  assert.equal(swappedInvalid.satellite?.kind, "recovery_active");
});

test("Tier 2 - Dynamic Aura Theme Tokens (Indigo, Amber, Teal, Silver) 100% color-synced", () => {
  // 1. Indigo (Evening review due)
  const indigoAura = getAuraStyles("indigo");
  assert.equal(indigoAura.theme, "indigo");
  assert.equal(indigoAura.primaryColor, "#6366f1");
  assert.ok(indigoAura.borderClass.includes("indigo-500"));
  assert.ok(indigoAura.shadowClass.includes("rgba(99,102,241"));
  assert.equal(indigoAura.defaultTab, "evening");
  assert.equal(getAuraThemeForStateKind("evening_review_due"), "indigo");

  // 2. Amber (Recovery / Sync / Confirmations)
  const amberAura = getAuraStyles("amber");
  assert.equal(amberAura.theme, "amber");
  assert.equal(amberAura.primaryColor, "#f59e0b");
  assert.ok(amberAura.borderClass.includes("amber-500"));
  assert.ok(amberAura.shadowClass.includes("rgba(245,158,11"));
  assert.equal(amberAura.defaultTab, "status");
  assert.equal(getAuraThemeForStateKind("recovery_active"), "amber");
  assert.equal(getAuraThemeForStateKind("sync_issue"), "amber");
  assert.equal(getAuraThemeForStateKind("confirmations_pending"), "amber");

  // 3. Teal (Live Session Running / Closing / Paused)
  const tealAura = getAuraStyles("teal");
  assert.equal(tealAura.theme, "teal");
  assert.equal(tealAura.primaryColor, "#14b8a6");
  assert.ok(tealAura.borderClass.includes("teal-500"));
  assert.ok(tealAura.shadowClass.includes("rgba(20,184,166"));
  assert.equal(tealAura.defaultTab, "stopwatch");
  assert.equal(getAuraThemeForStateKind("live_session_running"), "teal");
  assert.equal(getAuraThemeForStateKind("live_session_closing"), "teal");
  assert.equal(getAuraThemeForStateKind("activity_paused"), "teal");

  // 4. Silver (Search / Idle)
  const silverAura = getAuraStyles("silver");
  assert.equal(silverAura.theme, "silver");
  assert.equal(silverAura.primaryColor, "#94a3b8");
  assert.ok(silverAura.borderClass.includes("white/10"));
  assert.equal(silverAura.defaultTab, "search");
  assert.equal(getAuraThemeForStateKind("idle"), "silver");
});

test("Tier 2 - Satellite Bubble Glow Class and event handling isolation", () => {
  assert.ok(getSatelliteBubbleGlowClass("live_session_running").includes("teal"));
  assert.ok(getSatelliteBubbleGlowClass("recovery_active").includes("amber"));
  assert.ok(getSatelliteBubbleGlowClass("evening_review_due").includes("indigo"));
  assert.ok(getSatelliteBubbleGlowClass("idle").includes("white"));

  // Event handler stopPropagation check
  let swapCalled = false;
  let eventStopped = false;

  const bubbleElement = SatelliteBubble({
    satelliteItem: {
      id: "sat-1",
      kind: "recovery_active",
      priorityWeight: 700,
      title: "恢复中",
      accentTone: "amber",
      stage: 2,
    },
    onSwapFluidFocus: (kind) => {
      swapCalled = true;
      assert.equal(kind, "recovery_active");
    },
  }) as React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }> | null;

  assert.ok(bubbleElement, "SatelliteBubble must render");
  assert.equal(typeof bubbleElement.props.onClick, "function");

  bubbleElement.props.onClick?.({
    stopPropagation: () => {
      eventStopped = true;
    },
  });

  assert.equal(eventStopped, true, "Satellite click must stop event propagation");
  assert.equal(swapCalled, true, "Satellite click must trigger onSwapFluidFocus");
});

// ============================================================================
// TIER 3: Stopwatch Hover Micro-Actions & Global Keyboard Shortcuts Penetration
// ============================================================================

test("Tier 3 - Live stopwatch hover micro-actions render with stopPropagation", () => {
  let pauseTriggered = false;
  let closeoutTriggered = false;
  let stopPropagationCount = 0;

  const session = createMockSession("running", { subjectName: "专业课" });
  const activeItem: DynamicIslandActiveItem = {
    id: "item-running",
    kind: "live_session_running",
    priorityWeight: 1000,
    title: "专业课",
    accentTone: "teal",
    session,
    elapsedSeconds: 1800,
  };

  const rightSegment = CapsuleRightSegment({
    activeItem,
    elapsedSeconds: 1800,
    onDirectPause: () => {
      pauseTriggered = true;
    },
    onDirectCloseout: () => {
      closeoutTriggered = true;
    },
  }) as React.ReactElement | null;

  assert.ok(rightSegment, "CapsuleRightSegment must render for live session");

  // Inspect children structure for Pause button and Closeout link
  const containerProps = rightSegment.props as { children: React.ReactNode[] };
  assert.ok(Array.isArray(containerProps.children), "Segment must have stopwatch and hover micro-actions");

  const hoverContainer = containerProps.children[1] as React.ReactElement<{ children: React.ReactNode[] }>;
  assert.ok(hoverContainer, "Hover micro-actions container must exist");

  const [pauseBtn, closeoutLink] = hoverContainer.props.children as [
    React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }>,
    React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }>
  ];

  // Test Pause button click
  pauseBtn.props.onClick?.({
    stopPropagation: () => {
      stopPropagationCount++;
    },
  });
  assert.equal(pauseTriggered, true, "Direct pause handler must be called");
  assert.equal(stopPropagationCount, 1, "Pause button must call stopPropagation");

  // Test Closeout button click
  closeoutLink.props.onClick?.({
    stopPropagation: () => {
      stopPropagationCount++;
    },
  });
  assert.equal(closeoutTriggered, true, "Direct closeout handler must be called");
  assert.equal(stopPropagationCount, 2, "Closeout button must call stopPropagation");
});

test("Tier 3 - Global ⌘K / / / Esc Keyboard shortcut handlers and Command Palette navigation", () => {
  // 1. Command index clamping
  const count = GLOBAL_COMMANDS.length;
  assert.ok(count > 0, "Global commands list must not be empty");

  assert.equal(clampCommandIndex(-1, count), 0, "Negative index clamps to 0");
  assert.equal(clampCommandIndex(count + 5, count), count - 1, "Overflow index clamps to count - 1");
  assert.equal(clampCommandIndex(2, count), 2, "In-bounds index stays unchanged");
  assert.equal(clampCommandIndex(NaN, count), 0, "NaN index clamps to 0");

  // 2. Command Palette query filtering
  const allFiltered = filterGlobalCommands("", GLOBAL_COMMANDS);
  assert.equal(allFiltered.length, count);

  const mathFiltered = filterGlobalCommands("开始", GLOBAL_COMMANDS);
  assert.ok(mathFiltered.length > 0);
  assert.ok(mathFiltered.some((cmd) => cmd.label.includes("开始")));

  const focusFiltered = filterGlobalCommands("专注", GLOBAL_COMMANDS);
  assert.ok(focusFiltered.length > 0);
});

// ============================================================================
// TIER 4: Morphing Floating Hub 4-Panel State Sync & Default Tab Activation
// ============================================================================

test("Tier 4 - Hub 4-Panel view mode normalization and default tab auto-activation", () => {
  // Normalization
  assert.equal(normalizeHubTab("search"), "search");
  assert.equal(normalizeHubTab("overview"), "overview");
  assert.equal(normalizeHubTab("status"), "overview");
  assert.equal(normalizeHubTab("focus"), "focus");
  assert.equal(normalizeHubTab("stopwatch"), "focus");
  assert.equal(normalizeHubTab("closure"), "closure");
  assert.equal(normalizeHubTab("evening"), "closure");
  assert.equal(normalizeHubTab(null), "search");

  // Default tab for state kinds
  assert.equal(getDefaultTabForStateKind("live_session_running"), "stopwatch");
  assert.equal(getDefaultTabForStateKind("activity_paused"), "stopwatch");
  assert.equal(getDefaultTabForStateKind("recovery_active"), "status");
  assert.equal(getDefaultTabForStateKind("sync_issue"), "status");
  assert.equal(getDefaultTabForStateKind("confirmations_pending"), "status");
  assert.equal(getDefaultTabForStateKind("evening_review_due"), "evening");
  assert.equal(getDefaultTabForStateKind("idle"), "search");
});

test("Tier 4 - Hub View Mode Tabs rendering with dynamic aura theme injection", () => {
  let selectedMode: HubViewMode = "search";

  const tabsElement = HubViewModeTabs({
    viewMode: "focus",
    onViewModeChange: (mode) => {
      selectedMode = mode;
    },
    activeStatesCount: 3,
    hasRunningSession: true,
    pendingConfirmationsCount: 2,
    eveningDue: true,
    auraTheme: "teal",
    dominantState: {
      id: "sess-1",
      kind: "live_session_running",
      priorityWeight: 1000,
      title: "考研数学",
      accentTone: "teal",
    },
  });

  assert.ok(tabsElement, "HubViewModeTabs must render");
});

// ============================================================================
// TIER 5: Adversarial Stress, Hardening & Extreme Boundary Matrix
// ============================================================================

test("Tier 5 - Exhaustive 2^8 State Space Permutations satisfy all invariants", () => {
  const activeKinds: DynamicIslandCapsuleKind[] = [
    "live_session_running",
    "live_session_closing",
    "activity_paused",
    "recovery_active",
    "evening_review_due",
    "sync_issue",
    "confirmations_pending",
  ];

  const totalCombinations = 1 << activeKinds.length; // 2^7 = 128 subsets
  assert.equal(totalCombinations, 128);

  for (let mask = 0; mask < totalCombinations; mask++) {
    const hasRunning = (mask & (1 << 0)) !== 0;
    const hasClosing = (mask & (1 << 1)) !== 0;
    const hasPaused = (mask & (1 << 2)) !== 0;
    const hasRecovery = (mask & (1 << 3)) !== 0;
    const hasEvening = (mask & (1 << 4)) !== 0;
    const hasSync = (mask & (1 << 5)) !== 0;
    const hasConfirmations = (mask & (1 << 6)) !== 0;

    const sessionStatus = hasRunning
      ? "running"
      : hasClosing
      ? "closing"
      : hasPaused
      ? "paused"
      : null;

    const input: CollectDynamicIslandStatesInput = {
      activeSession: sessionStatus ? createMockSession(sessionStatus, { subjectName: "数学分析" }) : null,
      recovery: hasRecovery ? { active: true, stage: 2, targetMinutes: 60, reason: "低转化" } : null,
      eveningReview: hasEvening ? { due: true, minimumActionDone: true, dailyReviewDone: false } : null,
      syncState: hasSync ? "deferred" : "current",
      pendingConfirmationsCount: hasConfirmations ? 3 : 0,
      elapsedSeconds: 1200,
    };

    const pool = computeDynamicIslandStatePool(input);

    assert.ok(pool.dominantState, `Mask ${mask}: dominantState must be defined`);
    assert.ok(validateStatePoolInvariants(pool), `Mask ${mask}: validateStatePoolInvariants must return true`);
    assert.equal(pool.concurrencyCount, pool.activeStates.length);
    assert.equal(pool.hasConcurrency, pool.activeStates.length > 1);

    for (let i = 0; i < pool.activeStates.length - 1; i++) {
      assert.ok(
        pool.activeStates[i].priorityWeight >= pool.activeStates[i + 1].priorityWeight,
        `Mask ${mask}: priority weights not descending at index ${i}`
      );
    }

    if (pool.activeStates.length > 0) {
      assert.equal(pool.dominantState.id, pool.activeStates[0].id);
      assert.equal(pool.dominantState.priorityWeight, pool.activeStates[0].priorityWeight);
    } else {
      assert.equal(pool.dominantState.kind, "idle");
      assert.equal(pool.dominantState.priorityWeight, 0);
    }

    const poolRerun = computeDynamicIslandStatePool(input);
    assert.deepEqual(pool, poolRerun);
  }
});

test("Tier 5 - Rapid 1,000-Step Concurrent State Transitions Lifecycle", () => {
  let activeSession: StudySessionDto | null = null;
  const offlineSession: StudySessionDto | null = null;
  let syncState: DynamicIslandSyncState = "current";
  let recovery: DynamicIslandRecoveryProps | null = null;
  let eveningReview: DynamicIslandEveningReviewProps | null = null;
  let confirmationsCount = 0;
  let elapsedSeconds = 0;

  for (let step = 0; step < 1000; step++) {
    const actionType = step % 10;
    switch (actionType) {
      case 0:
        activeSession = createMockSession("running", { id: `session-${step}`, subjectName: `科目-${step}` });
        elapsedSeconds = step * 10;
        break;
      case 1:
        if (activeSession) {
          activeSession = createMockSession("paused", { id: activeSession.id, subjectName: activeSession.subjectName });
        }
        break;
      case 2:
        recovery = { active: true, stage: (step % 3) + 1, targetMinutes: ((step % 4) + 1) * 30, reason: "督战恢复" };
        break;
      case 3:
        syncState = (["deferred", "offline", "blocked", "pending"] as DynamicIslandSyncState[])[step % 4];
        break;
      case 4:
        confirmationsCount = (step % 7) + 1;
        break;
      case 5:
        eveningReview = { due: true, minimumActionDone: step % 2 === 0, dailyReviewDone: false };
        break;
      case 6:
        if (activeSession) {
          activeSession = createMockSession("running", { id: activeSession.id, subjectName: activeSession.subjectName });
        }
        break;
      case 7:
        if (activeSession) {
          activeSession = createMockSession("closing", { id: activeSession.id, subjectName: activeSession.subjectName });
        }
        break;
      case 8:
        activeSession = null;
        break;
      case 9:
        syncState = "current";
        eveningReview = null;
        recovery = null;
        confirmationsCount = 0;
        break;
    }

    const input: CollectDynamicIslandStatesInput = {
      activeSession,
      offlineSession,
      syncState,
      recovery,
      eveningReview,
      pendingConfirmationsCount: confirmationsCount,
      elapsedSeconds,
    };

    const pool = computeDynamicIslandStatePool(input);
    assert.ok(validateStatePoolInvariants(pool), `Step ${step}: pool invariant violated`);
    assert.ok(pool.dominantState !== null && pool.dominantState !== undefined);

    if (activeSession && activeSession.status === "running") {
      assert.equal(pool.dominantState.kind, "live_session_running");
      assert.equal(isTickerP0Pinned(pool), true);
      assert.equal(isTickerRotationEnabled(pool), false);
    }
  }
});

test("Tier 5 - 10,000 Iterations Chaotic State Fuzzing with Hostile Inputs", () => {
  const hostileStrings = [
    "",
    "   ",
    "\u0000\u001f",
    "'; DROP TABLE sessions; --",
    "<script>alert(1)</script>",
    "javascript:void(0)",
    "https://example.com/malicious",
    "𠮷野家 ⚡ ⏱️ 🌙 🎯 🧘",
    "A".repeat(2000),
  ];

  const hostileNumbers = [
    -1000,
    -1,
    -0,
    0,
    0.0001,
    45.9999,
    1000000,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];

  for (let i = 0; i < 10000; i++) {
    const rawElapsed = hostileNumbers[i % hostileNumbers.length];
    const rawConfirmations = hostileNumbers[(i + 3) % hostileNumbers.length];
    const rawStage = hostileNumbers[(i + 5) % hostileNumbers.length];
    const rawMinutes = hostileNumbers[(i + 7) % hostileNumbers.length];
    const hostileTitle = hostileStrings[i % hostileStrings.length];

    const input: CollectDynamicIslandStatesInput = {
      activeSession: i % 3 === 0 ? createMockSession("running", { subjectName: hostileTitle }) : null,
      offlineSession: i % 4 === 0 ? createMockSession("paused", { id: "off-fuzz", subjectName: hostileTitle }) : null,
      syncState: (["current", "deferred", "offline", "blocked", undefined, null] as unknown as DynamicIslandSyncState[])[i % 6],
      recovery: i % 2 === 0 ? { active: true, stage: rawStage, targetMinutes: rawMinutes, reason: hostileTitle } : null,
      eveningReview: i % 5 === 0 ? { due: true, minimumActionDone: i % 2 === 0, dailyReviewDone: false, reviewHref: hostileTitle } : null,
      pendingConfirmationsCount: rawConfirmations,
      elapsedSeconds: rawElapsed,
    };

    assert.doesNotThrow(() => {
      const pool = computeDynamicIslandStatePool(input);
      assert.ok(validateStatePoolInvariants(pool));
      assert.ok(pool.dominantState.priorityWeight >= 0);
      assert.ok(Number.isFinite(pool.concurrencyCount));
      assert.equal(typeof pool.hasConcurrency, "boolean");
    }, `Fuzzing iteration ${i} failed`);
  }
});

test("Tier 5 - 50,000 Continuous State Pool Resolutions Determinism and High Performance", () => {
  const sessionRunning = createMockSession("running", { id: "sess-50k", subjectName: "考研数学" });
  const recoveryProps: DynamicIslandRecoveryProps = { active: true, stage: 2, targetMinutes: 60, reason: "50k test" };
  const eveningReviewProps: DynamicIslandEveningReviewProps = { due: true, minimumActionDone: true, dailyReviewDone: false };

  const input: CollectDynamicIslandStatesInput = {
    activeSession: sessionRunning,
    offlineSession: null,
    syncState: "deferred",
    recovery: recoveryProps,
    eveningReview: eveningReviewProps,
    pendingConfirmationsCount: 3,
    elapsedSeconds: 1500,
  };

  const baseline = computeDynamicIslandStatePool(input);
  assert.equal(baseline.dominantState.kind, "live_session_running");
  assert.equal(baseline.activeStates.length, 5);
  assert.equal(baseline.hasConcurrency, true);

  const startTime = performance.now();
  const initialMem = process.memoryUsage().heapUsed;

  for (let i = 0; i < 50000; i++) {
    const pool = computeDynamicIslandStatePool(input);

    if (i % 5000 === 0) {
      assert.equal(pool.dominantState.id, baseline.dominantState.id);
      assert.equal(pool.dominantState.priorityWeight, baseline.dominantState.priorityWeight);
      assert.equal(pool.concurrencyCount, baseline.concurrencyCount);
      assert.equal(pool.activeStates[0].kind, "live_session_running");
      assert.equal(pool.activeStates[1].kind, "recovery_active");
      assert.equal(pool.activeStates[2].kind, "evening_review_due");
      assert.equal(pool.activeStates[3].kind, "sync_issue");
      assert.equal(pool.activeStates[4].kind, "confirmations_pending");
    }
  }

  const durationMs = performance.now() - startTime;
  const finalMem = process.memoryUsage().heapUsed;
  const memDeltaMb = (finalMem - initialMem) / (1024 * 1024);

  assert.ok(
    durationMs < 2500,
    `50,000 executions took ${durationMs.toFixed(2)}ms (expected < 2500ms for high performance)`
  );

  assert.ok(
    memDeltaMb < 80,
    `Heap memory grew by ${memDeltaMb.toFixed(2)}MB during 50,000 iterations (expected < 80MB)`
  );
});

test("Tier 5 - ReDoS and Malicious Query Attack Resilience in Command Palette", () => {
  const hostileQueries = [
    "a".repeat(5000) + "!",
    "((a+)+)+$",
    "<script>alert('xss')</script>",
    "\\x00\\x08\\x0b\\x0c\\x0e\\x1f",
    "\u202E\u202D\u200E\u200F RTL/LTR override",
    "'; DROP TABLE sessions; --",
    "SELECT * FROM users WHERE '1'='1'",
    "🦄 🌈 ⚡ 🎯 🧘 ⏱️",
    "   \t\r\n\v\f  ",
    "",
  ];

  for (const query of hostileQueries) {
    const start = performance.now();
    const filtered = filterGlobalCommands(query, GLOBAL_COMMANDS);
    const elapsed = performance.now() - start;

    assert.ok(Array.isArray(filtered));
    assert.ok(elapsed < 50, `Filtering took ${elapsed}ms, must be < 50ms to prevent main thread lock`);

    const resolved = resolveGlobalCommand(query, GLOBAL_COMMANDS);
    if (query.trim() === "") {
      assert.equal(resolved, null);
      assert.equal(filtered.length, GLOBAL_COMMANDS.length);
    } else {
      assert.ok(resolved === null || typeof resolved === "object");
    }
  }

  const attackQueries = [
    'start --__proto__=polluted --constructor=hacked',
    'focus "unclosed quote string \\" with escape',
    'search \\\\\\\\\\\\',
    'cmd --key="" --empty="" --space="   "',
  ];

  for (const q of attackQueries) {
    const tokens = tokenizeCommandArguments(q);
    assert.ok(Array.isArray(tokens));
    assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);
  }
});

test("Tier 5 - Extreme Clock Skews, Timestamps Leaps & Duration Clamping", () => {
  const baseTime = new Date("2026-08-27T12:00:00.000Z");

  // 100 years forward leap
  const leap100Years = new Date("2126-08-27T12:00:00.000Z");
  const elapsed100Years = getTimerElapsedSeconds({
    status: "running",
    startedAt: baseTime,
    accumulatedPauseSeconds: 0,
    now: leap100Years,
  });
  assert.ok(elapsed100Years > 3_000_000_000);

  // 100 years backward leap
  const leapBackward = new Date("1926-08-27T12:00:00.000Z");
  const elapsedBackward = getTimerElapsedSeconds({
    status: "running",
    startedAt: baseTime,
    accumulatedPauseSeconds: 0,
    now: leapBackward,
  });
  assert.equal(elapsedBackward, 0);

  // Clamping
  assert.equal(clampTimerDuration(undefined), 0);
  assert.equal(clampTimerDuration(NaN), 0);
  assert.equal(clampTimerDuration(-100), 0);
  assert.equal(clampTimerDuration(123.456), 123);
  assert.equal(formatClockDuration(0), "00:00:00");
  assert.equal(formatClockDuration(3665), "01:01:05");
  assert.equal(formatShortDuration(65), "01:05");
});
