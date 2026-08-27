import test from "node:test";
import assert from "node:assert/strict";
import {
  TICKER_INTERVAL_MS,
  TICKER_RESUME_GRACE_MS,
  getNextTickerIndex,
  getPrevTickerIndex,
  clampTickerIndex,
  computeBreathingPagination,
  isTickerRotationEnabled,
  computeTickerNextState,
} from "./dynamic-island-ticker";
import {
  getCapsuleGlowStyle,
  getCapsuleGlowClass,
} from "./dynamic-island-glow";
import {
  computeDynamicIslandStatePool,
} from "./dynamic-island-state-engine";
import {
  type DynamicIslandCapsuleKind,
} from "./dynamic-island-types";
import type { StudySessionDto } from "@/lib/contracts";

function createMockSession(
  status: "running" | "paused" | "closing" | "completed",
  overrides?: Partial<StudySessionDto>
): StudySessionDto {
  return {
    id: "session-ticker-test-01",
    subjectId: "subj-math-01",
    subjectName: "考研数学",
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
    startedAt: new Date(Date.now() - 1500 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
    pausedAt: status === "paused" ? new Date().toISOString() : null,
    endedAt: status === "completed" ? new Date().toISOString() : null,
    accumulatedPauseSeconds: 0,
    effectiveMinutes: 25,
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
// SUITE 1: Ticker Index Arithmetic & Cyclic Rotation Bounds
// ============================================================================

test("Smart Ticker: Timing constants adhere to 6000ms cadence and 2000ms grace period", () => {
  assert.equal(TICKER_INTERVAL_MS, 6000, "Ticker interval must be strictly 6000ms (6s)");
  assert.equal(TICKER_RESUME_GRACE_MS, 2000, "Ticker resume grace period must be 2000ms (2s)");
});

test("Smart Ticker: getNextTickerIndex advances cyclically and handles wraparound", () => {
  // 3-state pool
  assert.equal(getNextTickerIndex(0, 3), 1);
  assert.equal(getNextTickerIndex(1, 3), 2);
  assert.equal(getNextTickerIndex(2, 3), 0, "Index 2 on count 3 must wrap to 0");

  // 5-state pool
  assert.equal(getNextTickerIndex(3, 5), 4);
  assert.equal(getNextTickerIndex(4, 5), 0, "Index 4 on count 5 must wrap to 0");

  // Single item pool (count 1)
  assert.equal(getNextTickerIndex(0, 1), 0, "Single item must never advance beyond 0");

  // Edge cases: empty or negative count
  assert.equal(getNextTickerIndex(0, 0), 0);
  assert.equal(getNextTickerIndex(0, -1), 0);
});

test("Smart Ticker: getPrevTickerIndex steps backwards cyclically and handles reverse wraparound", () => {
  // 3-state pool
  assert.equal(getPrevTickerIndex(2, 3), 1);
  assert.equal(getPrevTickerIndex(1, 3), 0);
  assert.equal(getPrevTickerIndex(0, 3), 2, "Index 0 on count 3 must wrap back to 2");

  // 5-state pool
  assert.equal(getPrevTickerIndex(0, 5), 4, "Index 0 on count 5 must wrap back to 4");

  // Single item pool
  assert.equal(getPrevTickerIndex(0, 1), 0);

  // Edge cases: empty or negative count
  assert.equal(getPrevTickerIndex(0, 0), 0);
  assert.equal(getPrevTickerIndex(0, -5), 0);
});

test("Smart Ticker: clampTickerIndex sanitizes out-of-bound, NaN, and negative indices", () => {
  assert.equal(clampTickerIndex(0, 3), 0);
  assert.equal(clampTickerIndex(1, 3), 1);
  assert.equal(clampTickerIndex(2, 3), 2);
  assert.equal(clampTickerIndex(3, 3), 2, "Index >= count must clamp to count - 1");
  assert.equal(clampTickerIndex(99, 3), 2);
  assert.equal(clampTickerIndex(-1, 3), 0, "Negative index must clamp to 0");
  assert.equal(clampTickerIndex(-100, 3), 0);
  assert.equal(clampTickerIndex(NaN, 3), 0, "NaN index must safely normalize to 0");
  assert.equal(clampTickerIndex(1.7, 3), 1, "Floating index must floor");
  assert.equal(clampTickerIndex(0, 0), 0, "Zero count must clamp to 0");
});

// ============================================================================
// SUITE 2: P0 Live Session Pinning & Rotation Invariants
// ============================================================================

test("Smart Ticker: isTickerRotationEnabled strictly disables rotation when P0 Live Session is dominant", () => {
  // Case 1: P0 Live Session + Recovery P3 + Evening Review P4 (3 concurrent states)
  const poolWithP0 = computeDynamicIslandStatePool({
    activeSession: createMockSession("running"),
    recovery: { active: true, stage: 2, targetMinutes: 60 },
    eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
    elapsedSeconds: 1200,
  });

  assert.equal(poolWithP0.dominantState.kind, "live_session_running");
  assert.equal(poolWithP0.activeStates.length, 3);
  assert.equal(poolWithP0.hasConcurrency, true);

  // INVARIANT: P0 Live Session Running is PINNED and auto-rotation is DISABLED
  assert.equal(
    isTickerRotationEnabled(poolWithP0),
    false,
    "Auto-rotation must be disabled when P0 Live Session is dominant"
  );
});

test("Smart Ticker: isTickerRotationEnabled enables rotation when multiple non-P0 alerts exist", () => {
  // Case 2: Activity Paused P2 + Recovery P3 + Sync Issue P5 (3 concurrent non-P0 states)
  const poolNonP0 = computeDynamicIslandStatePool({
    activeSession: createMockSession("paused"),
    recovery: { active: true, stage: 1, targetMinutes: 30 },
    syncState: "deferred",
    elapsedSeconds: 600,
  });

  assert.equal(poolNonP0.dominantState.kind, "activity_paused");
  assert.equal(poolNonP0.activeStates.length, 3);
  assert.equal(poolNonP0.hasConcurrency, true);

  // Auto-rotation must be active for non-P0 multi-alert pool
  assert.equal(
    isTickerRotationEnabled(poolNonP0),
    true,
    "Auto-rotation must be enabled when multiple non-P0 alerts are present"
  );
});

test("Smart Ticker: isTickerRotationEnabled disables rotation for single state or idle baseline", () => {
  // Case 3: Single recovery alert
  const poolSingle = computeDynamicIslandStatePool({
    recovery: { active: true, stage: 1, targetMinutes: 30 },
  });
  assert.equal(poolSingle.activeStates.length, 1);
  assert.equal(isTickerRotationEnabled(poolSingle), false);

  // Case 4: Idle pool
  const poolIdle = computeDynamicIslandStatePool({});
  assert.equal(poolIdle.activeStates.length, 0);
  assert.equal(isTickerRotationEnabled(poolIdle), false);
});

test("Smart Ticker: computeTickerNextState pins P0 or advances unpaused non-P0 states", () => {
  // When P0 is pinned, next index is always pinned to 0
  const nextP0 = computeTickerNextState({
    currentIndex: 0,
    totalStates: 4,
    isPaused: false,
    hasP0Pinned: true,
  });
  assert.equal(nextP0, 0, "P0 pinned state must remain index 0");

  // When paused, index remains unchanged
  const nextPaused = computeTickerNextState({
    currentIndex: 1,
    totalStates: 3,
    isPaused: true,
    hasP0Pinned: false,
  });
  assert.equal(nextPaused, 1, "Paused state must not advance index");

  // When unpaused and non-P0, advances cyclically
  const nextActive = computeTickerNextState({
    currentIndex: 1,
    totalStates: 3,
    isPaused: false,
    hasP0Pinned: false,
  });
  assert.equal(nextActive, 2, "Active state must advance to index 2");

  const nextWrap = computeTickerNextState({
    currentIndex: 2,
    totalStates: 3,
    isPaused: false,
    hasP0Pinned: false,
  });
  assert.equal(nextWrap, 0, "Active state at last index must wrap to 0");
});

// ============================================================================
// SUITE 3: Pause, Focus & Grace Period Timing State Machine
// ============================================================================

test("Smart Ticker State Machine: simulates hover, focus, drawer and grace period transitions", () => {
  interface TickerMachineState {
    currentIndex: number;
    totalStates: number;
    hasP0Pinned: boolean;
    isHovered: boolean;
    isFocused: boolean;
    isDrawerOpen: boolean;
    graceTimerActive: boolean;
  }

  function isPaused(s: TickerMachineState): boolean {
    if (s.totalStates <= 1 || s.hasP0Pinned) return true;
    if (s.isHovered || s.isFocused || s.isDrawerOpen || s.graceTimerActive) return true;
    return false;
  }

  const state: TickerMachineState = {
    currentIndex: 0,
    totalStates: 3,
    hasP0Pinned: false,
    isHovered: false,
    isFocused: false,
    isDrawerOpen: false,
    graceTimerActive: false,
  };

  // 1. Initial running state
  assert.equal(isPaused(state), false, "Ticker should be running initially for 3 non-P0 states");

  // 2. Mouse enter triggers immediate pause
  state.isHovered = true;
  assert.equal(isPaused(state), true, "Hover must pause ticker immediately");

  // 3. Mouse leave triggers grace period
  state.isHovered = false;
  state.graceTimerActive = true;
  assert.equal(isPaused(state), true, "Grace period must keep ticker paused");

  // 4. Grace timer expires (2000ms)
  state.graceTimerActive = false;
  assert.equal(isPaused(state), false, "Ticker resumes once grace timer expires");

  // 5. Input focus triggers pause
  state.isFocused = true;
  assert.equal(isPaused(state), true, "Search input focus must pause ticker");

  // 6. Input blur starts grace timer
  state.isFocused = false;
  state.graceTimerActive = true;
  assert.equal(isPaused(state), true);
  state.graceTimerActive = false;
  assert.equal(isPaused(state), false);

  // 7. Drawer open triggers pause
  state.isDrawerOpen = true;
  assert.equal(isPaused(state), true, "Hub drawer open must pause ticker");

  // 8. Drawer close resumes after grace period
  state.isDrawerOpen = false;
  state.graceTimerActive = false;
  assert.equal(isPaused(state), false);
});

// ============================================================================
// SUITE 4: Breathing Pagination & State Indicator Generator
// ============================================================================

test("Smart Ticker: computeBreathingPagination generates correct active/inactive dot descriptors", () => {
  // 3-state pool, index 0 active
  const dots0 = computeBreathingPagination(0, 3);
  assert.equal(dots0.length, 3);
  assert.deepEqual(
    dots0.map((d) => d.isActive),
    [true, false, false]
  );
  assert.equal(dots0[0].index, 0);

  // 3-state pool, index 1 active
  const dots1 = computeBreathingPagination(1, 3);
  assert.equal(dots1.length, 3);
  assert.deepEqual(
    dots1.map((d) => d.isActive),
    [false, true, false]
  );

  // 3-state pool, index 2 active
  const dots2 = computeBreathingPagination(2, 3);
  assert.deepEqual(
    dots2.map((d) => d.isActive),
    [false, false, true]
  );
});

test("Smart Ticker: computeBreathingPagination returns empty array for single or zero states", () => {
  assert.deepEqual(computeBreathingPagination(0, 1), [], "Single state should not show pagination dots");
  assert.deepEqual(computeBreathingPagination(0, 0), [], "Zero states should not show pagination dots");
  assert.deepEqual(computeBreathingPagination(-1, 0), []);
});

test("Smart Ticker: computeBreathingPagination generates accessible labels for all dots", () => {
  const dots = computeBreathingPagination(1, 4);
  assert.equal(dots.length, 4);
  assert.equal(dots[0].label, "第 1 项 (共 4 项)");
  assert.equal(dots[1].label, "第 2 项 (当前激活，共 4 项)");
  assert.equal(dots[2].label, "第 3 项 (共 4 项)");
  assert.equal(dots[3].label, "第 4 项 (共 4 项)");
});

// ============================================================================
// SUITE 5: Capsule Micro-Glow Style Token Generator (dynamic-island-glow.ts)
// ============================================================================

test("Glow Styling: getCapsuleGlowStyle returns exact ring and shadow tokens when closed", () => {
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
    const style = getCapsuleGlowStyle(kind, false);
    assert.ok(style.length > 0, `Closed style for ${kind} must not be empty`);

    if (kind === "live_session_running") {
      assert.ok(style.includes("border-teal-500/40"));
      assert.ok(style.includes("shadow-[0_0_20px_rgba(45,212,191,0.22)]"));
      assert.ok(style.includes("ring-teal-400/20"));
    } else if (kind === "live_session_closing") {
      assert.ok(style.includes("border-emerald-500/40"));
      assert.ok(style.includes("shadow-[0_0_16px_rgba(52,211,153,0.2)]"));
    } else if (kind === "activity_paused") {
      assert.ok(style.includes("border-emerald-500/35"));
    } else if (kind === "recovery_active" || kind === "confirmations_pending") {
      assert.ok(style.includes("border-amber-400/40"));
      assert.ok(style.includes("shadow-[0_0_18px_rgba(251,191,36,0.18)]"));
    } else if (kind === "evening_review_due") {
      assert.ok(style.includes("border-indigo-400/40"));
      assert.ok(style.includes("shadow-[0_0_18px_rgba(129,140,248,0.2)]"));
    } else if (kind === "sync_issue") {
      assert.ok(style.includes("border-amber-400/35"));
    } else if (kind === "idle") {
      assert.ok(style.includes("border-white/10"));
    }
  }
});

test("Glow Styling: getCapsuleGlowStyle returns empty string when drawer is open", () => {
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
    assert.equal(
      getCapsuleGlowStyle(kind, true),
      "",
      `Open drawer glow style for ${kind} must be empty string`
    );
  }
});

test("Glow Styling: getCapsuleGlowClass maps tones correctly", () => {
  assert.ok(getCapsuleGlowClass("teal", false).includes("teal"));
  assert.ok(getCapsuleGlowClass("emerald", false).includes("emerald"));
  assert.ok(getCapsuleGlowClass("amber", false).includes("amber"));
  assert.ok(getCapsuleGlowClass("indigo", false).includes("indigo"));
  assert.ok(getCapsuleGlowClass("zinc", false).includes("white/10"));
  assert.equal(getCapsuleGlowClass("teal", true), "");
});
