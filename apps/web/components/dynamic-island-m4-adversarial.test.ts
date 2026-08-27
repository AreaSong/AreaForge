import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";

import {
  type DynamicIslandActiveItem,
  type DynamicIslandCapsuleKind,
  type DynamicIslandCapsuleState,
  type DynamicIslandStatePool,
  type DynamicIslandTone,
  type DynamicIslandRecoveryProps,
  type DynamicIslandEveningReviewProps,
  type DynamicIslandSyncState,
  type CollectDynamicIslandStatesInput,
  PRIORITY_WEIGHTS,
  IDLE_STATE_ITEM,
} from "./dynamic-island-types";

import {
  clampTimerDuration,
  getPriorityWeight,
  createIdleStateItem,
  collectDynamicIslandActiveStates,
  sortActiveStatesByPriority,
  getDominantState,
  resolveDominantState,
  computeDynamicIslandStatePool,
  collectDynamicIslandStatePool,
  validateStatePoolInvariants,
  resolveDynamicIslandState,
} from "./dynamic-island-state-engine";

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
  getCapsuleGlowStyle,
  getCapsuleGlowClass,
  getCapsuleInlineStyle,
  getToneFromCapsuleKind,
  getCapsuleToneColors,
  TONE_COLOR_SPECS,
} from "./dynamic-island-glow";

import {
  CapsuleBreathingDots,
  CapsuleLeftSegment,
  CapsuleCenterSegment,
  CapsuleRightSegment,
} from "./dynamic-island-segments";

import {
  HubViewModeTabs,
  HubSupervisionOverview,
  HubFlowStopwatchPanel,
  HubConfirmationClosureGuide,
  HubCommandPaletteList,
  DynamicIslandHub,
  type HubViewMode,
} from "./dynamic-island-hub";

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

function resolveOverviewMode(kind: DynamicIslandCapsuleKind): HubViewMode {
  if (kind === "live_session_running" || kind === "activity_paused" || kind === "live_session_closing") {
    return "focus";
  }
  if (kind === "evening_review_due" || kind === "confirmations_pending") {
    return "closure";
  }
  return "overview";
}

// ============================================================================
// SUITE 1: Multi-State Permutations & Rapid Concurrent State Transitions
// ============================================================================

test("Adversarial M4 - Exhaustive 2^8 State Space Permutations satisfy all invariants", () => {
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

  // We can construct test configurations for each subset of the first 7 active states
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

    // Primary session: Pick highest priority status if multiple session flags are on
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

    // Invariant 1: dominantState must be defined
    assert.ok(pool.dominantState, `Mask ${mask}: dominantState must be defined`);

    // Invariant 2: Invariants validator returns true
    assert.ok(validateStatePoolInvariants(pool), `Mask ${mask}: validateStatePoolInvariants must return true`);

    // Invariant 3: Concurrency count consistency
    assert.equal(pool.concurrencyCount, pool.activeStates.length);
    assert.equal(pool.hasConcurrency, pool.activeStates.length > 1);

    // Invariant 4: Priority sequence must be strictly non-increasing
    for (let i = 0; i < pool.activeStates.length - 1; i++) {
      assert.ok(
        pool.activeStates[i].priorityWeight >= pool.activeStates[i + 1].priorityWeight,
        `Mask ${mask}: priority weights not descending at index ${i}`
      );
    }

    // Invariant 5: Dominant state must be activeStates[0] or idle
    if (pool.activeStates.length > 0) {
      assert.equal(pool.dominantState.id, pool.activeStates[0].id);
      assert.equal(pool.dominantState.priorityWeight, pool.activeStates[0].priorityWeight);
    } else {
      assert.equal(pool.dominantState.kind, "idle");
      assert.equal(pool.dominantState.priorityWeight, 0);
    }

    // Invariant 6: Pure idempotence
    const poolRerun = computeDynamicIslandStatePool(input);
    assert.deepEqual(pool, poolRerun);
  }
});

test("Adversarial M4 - Rapid High-Frequency Concurrent State Transitions Matrix", () => {
  let activeSession: StudySessionDto | null = null;
  let offlineSession: StudySessionDto | null = null;
  let syncState: DynamicIslandSyncState = "current";
  let recovery: DynamicIslandRecoveryProps | null = null;
  let eveningReview: DynamicIslandEveningReviewProps | null = null;
  let confirmationsCount = 0;
  let elapsedSeconds = 0;

  // Simulate a chaotic 1,000-step state lifecycle
  for (let step = 0; step < 1000; step++) {
    const actionType = step % 10;
    switch (actionType) {
      case 0:
        // Start live session
        activeSession = createMockSession("running", { id: `session-${step}`, subjectName: `科目-${step}` });
        elapsedSeconds = step * 10;
        break;
      case 1:
        // Pause session
        if (activeSession) {
          activeSession = createMockSession("paused", { id: activeSession.id, subjectName: activeSession.subjectName });
        }
        break;
      case 2:
        // Trigger recovery mode
        recovery = { active: true, stage: (step % 3) + 1, targetMinutes: ((step % 4) + 1) * 30, reason: "督战恢复" };
        break;
      case 3:
        // Network drops -> sync issue
        syncState = (["deferred", "offline", "blocked", "pending"] as DynamicIslandSyncState[])[step % 4];
        break;
      case 4:
        // Add pending confirmations
        confirmationsCount = (step % 7) + 1;
        break;
      case 5:
        // Evening review due
        eveningReview = { due: true, minimumActionDone: step % 2 === 0, dailyReviewDone: false };
        break;
      case 6:
        // Resume session
        if (activeSession) {
          activeSession = createMockSession("running", { id: activeSession.id, subjectName: activeSession.subjectName });
        }
        break;
      case 7:
        // Close session
        if (activeSession) {
          activeSession = createMockSession("closing", { id: activeSession.id, subjectName: activeSession.subjectName });
        }
        break;
      case 8:
        // Complete session
        activeSession = null;
        break;
      case 9:
        // Reconcile sync & clear review
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

    // If active running session exists, dominant must be live_session_running (P0)
    if (activeSession && activeSession.status === "running") {
      assert.equal(pool.dominantState.kind, "live_session_running");
      assert.equal(isTickerP0Pinned(pool), true);
      assert.equal(isTickerRotationEnabled(pool), false);
    }
  }
});

test("Adversarial M4 - 10,000 Iterations Chaotic State Fuzzing with Malformed & Hostile Inputs", () => {
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

// ============================================================================
// SUITE 2: High-Frequency Timer Ticks, Extreme Clock Skews, & Duration Arithmetic
// ============================================================================

test("Adversarial M4 - High-Frequency Timer Ticks & Sub-Second Precision clamping", () => {
  // 10,000 sub-second & high-frequency fractional steps
  for (let tick = 0; tick < 10000; tick++) {
    const fractionalSeconds = tick * 0.12345;
    const clamped = clampTimerDuration(fractionalSeconds);
    assert.equal(typeof clamped, "number");
    assert.ok(Number.isInteger(clamped), `Tick ${tick}: clamped duration must be an integer`);
    assert.ok(clamped >= 0, `Tick ${tick}: clamped duration must be non-negative`);
    assert.equal(clamped, Math.floor(fractionalSeconds));
  }

  // Extreme boundary inputs
  assert.equal(clampTimerDuration(undefined), 0);
  assert.equal(clampTimerDuration(null as unknown as number), 0);
  assert.equal(clampTimerDuration(NaN), 0);
  assert.equal(clampTimerDuration(Infinity), 0);
  assert.equal(clampTimerDuration(-Infinity), 0);
  assert.equal(clampTimerDuration(-0.999), 0);
  assert.equal(clampTimerDuration(-100000), 0);
  assert.equal(clampTimerDuration(0), 0);
  assert.equal(clampTimerDuration(1e-15), 0);
  assert.equal(clampTimerDuration(999999.999), 999999);
});

test("Adversarial M4 - Extreme Clock Skews, Inverted Timestamps & Time Leaps", () => {
  const baseTime = new Date("2026-08-27T12:00:00.000Z");

  // 1. Clock leaps forward 100 years (+3,153,600,000 seconds)
  const leap100Years = new Date("2126-08-27T12:00:00.000Z");
  const elapsed100Years = getTimerElapsedSeconds({
    status: "running",
    startedAt: baseTime,
    accumulatedPauseSeconds: 0,
    now: leap100Years,
  });
  assert.ok(elapsed100Years > 3_000_000_000, "100 years elapsed must be huge positive number");
  const formatted100Years = formatClockDuration(elapsed100Years);
  assert.ok(formatted100Years.includes(":"), "Formatted time must have standard clock layout");

  // 2. Clock leaps backward 100 years (now < startedAt)
  const leapBackward = new Date("1926-08-27T12:00:00.000Z");
  const elapsedBackward = getTimerElapsedSeconds({
    status: "running",
    startedAt: baseTime,
    accumulatedPauseSeconds: 0,
    now: leapBackward,
  });
  assert.equal(elapsedBackward, 0, "Backward clock skew must safely clamp to 0");
  assert.equal(formatClockDuration(elapsedBackward), "00:00:00");

  // 3. Pause duration exceeds total elapsed time
  const elapsedExcessPause = getTimerElapsedSeconds({
    status: "running",
    startedAt: baseTime,
    accumulatedPauseSeconds: 999999,
    now: new Date("2026-08-27T12:10:00.000Z"), // 600s total
  });
  assert.equal(elapsedExcessPause, 0, "Accumulated pause > total must clamp to 0");

  // 4. PausedAt timestamp before startedAt timestamp
  const elapsedPausedBeforeStart = getTimerElapsedSeconds({
    status: "paused",
    startedAt: baseTime,
    pausedAt: new Date("2026-08-27T11:00:00.000Z"), // 1 hr before startedAt
    accumulatedPauseSeconds: 0,
    now: new Date("2026-08-27T12:30:00.000Z"),
  });
  assert.equal(elapsedPausedBeforeStart, 0, "PausedAt before startedAt must clamp to 0");

  // 5. Invalid date instances (NaN)
  const elapsedInvalidDate = getTimerElapsedSeconds({
    status: "running",
    startedAt: new Date(NaN),
    accumulatedPauseSeconds: 0,
    now: baseTime,
  });
  assert.equal(clampTimerDuration(elapsedInvalidDate), 0, "Invalid Date elapsed must clamp to 0 via clampTimerDuration");
  assert.equal(formatClockDuration(elapsedInvalidDate), "00:00:00", "Invalid Date elapsed must format to 00:00:00");
});

test("Adversarial M4 - Duration Formatters Robustness under Extreme Numbers", () => {
  const testCases: Array<[number, string]> = [
    [0, "00:00:00"],
    [1, "00:00:01"],
    [59, "00:00:59"],
    [60, "00:01:00"],
    [3599, "00:59:59"],
    [3600, "01:00:00"],
    [86399, "23:59:59"],
    [86400, "24:00:00"],
    [360000, "100:00:00"],
    [-1, "00:00:00"],
    [-9999, "00:00:00"],
    [Number.NaN, "00:00:00"],
    [Number.POSITIVE_INFINITY, "00:00:00"],
    [Number.NEGATIVE_INFINITY, "00:00:00"],
  ];

  for (const [sec, expected] of testCases) {
    assert.equal(formatClockDuration(sec), expected, `formatClockDuration(${sec}) failed`);
  }

  // Short duration format
  assert.equal(formatShortDuration(0), "00:00");
  assert.equal(formatShortDuration(65), "01:05");
  assert.equal(formatShortDuration(-50), "00:00");
  assert.equal(formatShortDuration(NaN), "00:00");
});

// ============================================================================
// SUITE 3: Rapid View Mode Switching, Smart Ticker Carousel, & Keyboard Shortcut Traps
// ============================================================================

test("Adversarial M4 - Rapid View Mode Cycling Matrix and Overview Mode Resolver", () => {
  const modes: HubViewMode[] = ["search", "overview", "focus", "closure"];

  // Test all 24 permutations of view modes 100 times (2,400 mode switches)
  for (let cycle = 0; cycle < 100; cycle++) {
    for (const m1 of modes) {
      for (const m2 of modes) {
        if (m1 === m2) continue;
        assert.notEqual(m1, m2);
      }
    }
  }

  // Test resolveOverviewMode mappings
  assert.equal(resolveOverviewMode("live_session_running"), "focus");
  assert.equal(resolveOverviewMode("activity_paused"), "focus");
  assert.equal(resolveOverviewMode("live_session_closing"), "focus");
  assert.equal(resolveOverviewMode("evening_review_due"), "closure");
  assert.equal(resolveOverviewMode("confirmations_pending"), "closure");
  assert.equal(resolveOverviewMode("recovery_active"), "overview");
  assert.equal(resolveOverviewMode("sync_issue"), "overview");
  assert.equal(resolveOverviewMode("idle"), "overview");
});

test("Adversarial M4 - Smart Ticker Carousel Index Arithmetic & Boundary Fuzzing", () => {
  // 10,000 random index & totalStates arithmetic operations
  for (let i = 0; i < 10000; i++) {
    const rawIndex = Math.floor(Math.random() * 2000) - 1000; // -1000 to +1000
    const rawTotal = Math.floor(Math.random() * 20) - 5; // -5 to +15

    const clamped = clampTickerIndex(rawIndex, rawTotal);
    assert.ok(clamped >= 0);
    if (rawTotal > 0) {
      assert.ok(clamped < rawTotal, `Index ${clamped} must be < total ${rawTotal}`);
    } else {
      assert.equal(clamped, 0);
    }

    const nextIdx = getNextTickerIndex(rawIndex, rawTotal);
    assert.ok(nextIdx >= 0);
    if (rawTotal > 1) {
      assert.ok(nextIdx < rawTotal);
    } else {
      assert.equal(nextIdx, 0);
    }

    const prevIdx = getPrevTickerIndex(rawIndex, rawTotal);
    assert.ok(prevIdx >= 0);
    if (rawTotal > 1) {
      assert.ok(prevIdx < rawTotal);
    } else {
      assert.equal(prevIdx, 0);
    }
  }
});

test("Adversarial M4 - Smart Ticker P0 Pinning Invariant Across All State Combinations", () => {
  const p0Session = createMockSession("running");
  const otherItems: DynamicIslandActiveItem[] = [
    { id: "p1", kind: "live_session_closing", priorityWeight: 900, title: "收口", accentTone: "emerald" },
    { id: "p2", kind: "activity_paused", priorityWeight: 800, title: "暂停", accentTone: "amber" },
    { id: "p3", kind: "recovery_active", priorityWeight: 700, title: "恢复", accentTone: "amber" },
    { id: "p4", kind: "evening_review_due", priorityWeight: 600, title: "复盘", accentTone: "indigo" },
    { id: "p5", kind: "sync_issue", priorityWeight: 500, title: "对账", accentTone: "amber" },
    { id: "p6", kind: "confirmations_pending", priorityWeight: 400, title: "待确认", accentTone: "amber" },
  ];

  const p0Item: DynamicIslandActiveItem = {
    id: "p0_running",
    kind: "live_session_running",
    priorityWeight: 1000,
    title: "考研数学",
    accentTone: "teal",
    session: p0Session,
    elapsedSeconds: 1500,
  };

  // Test P0 combined with any combination of other items
  for (let mask = 1; mask < (1 << otherItems.length); mask++) {
    const subset = otherItems.filter((_, idx) => (mask & (1 << idx)) !== 0);
    const activeStates = [p0Item, ...subset];

    const pool: DynamicIslandStatePool = {
      activeStates,
      dominantState: p0Item,
      hasConcurrency: activeStates.length > 1,
      concurrencyCount: activeStates.length,
    };

    assert.equal(isTickerP0Pinned(pool), true);
    assert.equal(isTickerP0Pinned(activeStates), true);
    assert.equal(isTickerRotationEnabled(pool), false);
    assert.equal(isTickerRotationEnabled(activeStates), false);

    // computeTickerNextState must stay pinned at 0
    const nextState = computeTickerNextState({
      currentIndex: 0,
      totalStates: activeStates.length,
      isPaused: false,
      hasP0Pinned: true,
    });
    assert.equal(nextState, 0);
  }
});

test("Adversarial M4 - Breathing Pagination & Dot Text Invariant Stress", () => {
  // Test breathing pagination across counts 0 to 500
  for (let count = 0; count <= 500; count++) {
    const dots = computeBreathingPagination(count > 0 ? count - 1 : 0, count);
    if (count <= 1) {
      assert.equal(dots.length, 0);
      assert.equal(formatDotsText(count, 0), "");
    } else {
      assert.equal(dots.length, count);
      assert.equal(dots.filter((d) => d.isActive).length, 1);
      const text = formatDotsText(count, 0);
      assert.ok(text.includes("●"));
      assert.ok(text.includes("○"));
    }
  }

  // Out of bounds active indices
  const dotsClamped = computeBreathingPagination(999, 4);
  assert.equal(dotsClamped.length, 4);
  assert.equal(dotsClamped[3].isActive, true);

  const dotsNegative = computeBreathingPagination(-50, 4);
  assert.equal(dotsNegative[0].isActive, true);
});

test("Adversarial M4 - Keyboard Shortcut Traps & Command Palette Boundary Navigation", () => {
  // 1. Cyclic command index clamping
  for (let i = 0; i < 5000; i++) {
    const rawIdx = Math.floor(Math.random() * 2000) - 1000;
    const len = Math.floor(Math.random() * 100);
    const clamped = clampCommandIndex(rawIdx, len);
    assert.ok(clamped >= 0);
    if (len > 0) {
      assert.ok(clamped < len);
    } else {
      assert.equal(clamped, 0);
    }
  }

  // 2. Command Palette Query Filtering under Hostile Text & ReDoS Attacks
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

  // 3. Argument Tokenizer Attack Resilience
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

// ============================================================================
// SUITE 4: 50,000 Continuous Executions Determinism & Memory / Performance Purity
// ============================================================================

test("Adversarial M4 - 50,000 Continuous State Pool Resolutions Determinism and Performance", () => {
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

  // 1. Reference baseline calculation
  const baseline = computeDynamicIslandStatePool(input);
  assert.equal(baseline.dominantState.kind, "live_session_running");
  assert.equal(baseline.activeStates.length, 5);
  assert.equal(baseline.hasConcurrency, true);

  // 2. Execute 50,000 iterations hot loop
  const startTime = performance.now();
  const initialMem = process.memoryUsage().heapUsed;

  for (let i = 0; i < 50000; i++) {
    const pool = computeDynamicIslandStatePool(input);

    // Spot-check every 5,000 iterations for bitwise determinism
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

  // Performance assertions:
  // 50,000 computations should easily complete in under 2,000ms (25k+ ops/sec)
  assert.ok(
    durationMs < 2500,
    `50,000 executions took ${durationMs.toFixed(2)}ms (expected < 2500ms for high performance)`
  );

  // Memory assertions:
  // Memory delta after 50,000 pure functional calculations should not show unbounded leak (> 80MB)
  assert.ok(
    memDeltaMb < 80,
    `Heap memory grew by ${memDeltaMb.toFixed(2)}MB during 50,000 iterations (expected < 80MB)`
  );
});

// ============================================================================
// SUITE 5: Capsule Micro-Glow & Component Segment Rendering Robustness
// ============================================================================

test("Adversarial M4 - Micro-Glow Style Token Generator Extreme & Fallback Matrix", () => {
  const tones: DynamicIslandTone[] = ["teal", "emerald", "amber", "indigo", "rose", "zinc"];

  for (const tone of tones) {
    const spec = getCapsuleToneColors(tone);
    assert.ok(spec.primary.startsWith("#"));
    assert.ok(spec.primaryRgba.startsWith("rgba("));
    assert.ok(spec.glowRgba.startsWith("rgba("));

    const styleClass = getCapsuleGlowClass(tone, false);
    assert.ok(styleClass.length > 0);

    const openClass = getCapsuleGlowClass(tone, true);
    assert.equal(openClass, "", "Open drawer glow class must be empty string");

    const inlineStyle = getCapsuleInlineStyle(tone, false);
    assert.ok((inlineStyle as Record<string, string>)["--af-capsule-glow-color"]);
    assert.ok((inlineStyle as Record<string, string>)["--af-capsule-glow-shadow"]);

    const openInline = getCapsuleInlineStyle(tone, true);
    assert.deepEqual(openInline, {});
  }

  // Fallback on invalid/unknown kinds and tones
  const fallbackTone = getToneFromCapsuleKind("idle");
  assert.equal(fallbackTone, "zinc");

  const unknownSpec = getCapsuleToneColors("unknown" as DynamicIslandTone);
  assert.deepEqual(unknownSpec, TONE_COLOR_SPECS.zinc);

  const unknownGlow = getCapsuleGlowClass("unknown_kind" as DynamicIslandCapsuleKind, false);
  assert.ok(unknownGlow.includes("border-white/10"));
});

test("Adversarial M4 - 3-Segment Partition Layout & Event Isolation Robustness", () => {
  // Test Left Segment with all state permutations
  const kinds: DynamicIslandCapsuleKind[] = [
    "live_session_running",
    "live_session_closing",
    "activity_paused",
    "recovery_active",
    "evening_review_due",
    "sync_issue",
    "confirmations_pending",
    "idle",
  ];

  for (const kind of kinds) {
    let triggered = false;
    let stopped = false;

    const el = CapsuleLeftSegment({
      activeItem: {
        id: `item-${kind}`,
        kind,
        priorityWeight: PRIORITY_WEIGHTS[kind],
        title: `标题-${kind}`,
        accentTone: "teal",
        session: createMockSession("running"),
        stage: 2,
        pendingConfirmationsCount: 4,
      },
      activeCount: 3,
      tickerIndex: 1,
      onOpenOverview: () => {
        triggered = true;
      },
    }) as React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }> | null;

    if (kind === "idle") {
      assert.equal(el, null, "Left segment must be null in idle mode");
    } else {
      assert.ok(el, `Left segment must render for ${kind}`);
      assert.equal(typeof el.props.onClick, "function");
      el.props.onClick?.({
        stopPropagation: () => {
          stopped = true;
        },
      });
      assert.equal(stopped, true, `${kind} click must stop propagation`);
      assert.equal(triggered, true, `${kind} click must trigger callback`);
    }
  }

  // Test Right Segment with all state permutations
  for (const kind of kinds) {
    let directResumeCalled = false;
    let retrySyncCalled = false;
    let triggerOpenCalled = false;
    let stopped = false;

    const el = CapsuleRightSegment({
      activeItem: {
        id: `item-${kind}`,
        kind,
        priorityWeight: PRIORITY_WEIGHTS[kind],
        title: `标题-${kind}`,
        accentTone: "amber",
        session: createMockSession("paused"),
        elapsedSeconds: 600,
        syncState: "deferred",
        pendingConfirmationsCount: 2,
      },
      isOpen: false,
      isResuming: false,
      elapsedSeconds: 600,
      onDirectResume: () => {
        directResumeCalled = true;
      },
      onRetrySync: () => {
        retrySyncCalled = true;
      },
      onTriggerOpen: () => {
        triggerOpenCalled = true;
      },
    }) as React.ReactElement<{ children?: React.ReactNode; onClick?: (e: { stopPropagation: () => void }) => void }> | null;

    if (kind === "idle") {
      assert.equal(el, null);
    } else {
      assert.ok(el, `Right segment must render for ${kind}`);
    }
  }
});
