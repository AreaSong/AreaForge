import test from "node:test";
import assert from "node:assert/strict";
import {
  collectDynamicIslandActiveStates,
  sortActiveStatesByPriority,
  getDominantState,
  resolveDominantState,
  computeDynamicIslandStatePool,
  collectDynamicIslandStatePool,
  resolveDynamicIslandState,
  createIdleStateItem,
  getPriorityWeight,
  clampTimerDuration,
  validateStatePoolInvariants,
  isStateSuppressedOnRoute,
  filterStatesByRouteContext,
  resolveDualTaskStates,
} from "./dynamic-island-state-engine";
import {
  getAuraThemeForStateKind,
  getAuraThemeFromKind,
  getDefaultTabForStateKind,
  getDefaultHubTabForKind,
  getAuraStyles,
  DYNAMIC_ISLAND_AURA_THEMES,
} from "./dynamic-island-glow";
import {
  PRIORITY_WEIGHTS,
  type DynamicIslandCapsuleKind,
  type DynamicIslandRecoveryProps,
  type DynamicIslandEveningReviewProps,
  type DynamicIslandSyncState,
  type CollectDynamicIslandStatesInput,
} from "./dynamic-island-types";
import type { StudySessionDto } from "@/lib/contracts";

function createMockSession(
  status: "running" | "paused" | "closing" | "completed",
  overrides?: Partial<StudySessionDto>
): StudySessionDto {
  return {
    id: "session-m1-test-01",
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
// SUITE 1: Individual State Resolution (P0 through P7)
// ============================================================================

test("M1 Individual State: P0 Live Session Running", () => {
  const session = createMockSession("running", { subjectName: "考研数学" });
  const pool = computeDynamicIslandStatePool({
    activeSession: session,
    offlineSession: null,
    elapsedSeconds: 1500,
  });

  assert.equal(pool.activeStates.length, 1);
  assert.equal(pool.hasConcurrency, false);
  assert.equal(pool.concurrencyCount, 1);

  const dominant = pool.dominantState;
  assert.equal(dominant.kind, "live_session_running");
  assert.equal(dominant.priorityWeight, PRIORITY_WEIGHTS.live_session_running); // 1000
  assert.equal(dominant.accentTone, "teal");
  assert.equal(dominant.title, "考研数学");
  assert.equal(dominant.elapsedSeconds, 1500);
  assert.equal(dominant.session?.id, "session-m1-test-01");
  assert.equal(dominant.quickAction?.type, "resume");
  assert.ok(validateStatePoolInvariants(pool));
});

test("M1 Individual State: P1 Live Session Closing", () => {
  const session = createMockSession("closing", { subjectName: "专业课代码" });
  const pool = computeDynamicIslandStatePool({
    activeSession: session,
    offlineSession: null,
    elapsedSeconds: 2700,
  });

  assert.equal(pool.activeStates.length, 1);
  assert.equal(pool.hasConcurrency, false);

  const dominant = pool.dominantState;
  assert.equal(dominant.kind, "live_session_closing");
  assert.equal(dominant.priorityWeight, PRIORITY_WEIGHTS.live_session_closing); // 900
  assert.equal(dominant.accentTone, "emerald");
  assert.equal(dominant.title, "专业课代码");
  assert.equal(dominant.quickAction?.type, "closeout");
  assert.equal(dominant.quickAction?.label, "去收口");
  assert.ok(validateStatePoolInvariants(pool));
});

test("M1 Individual State: P2 Activity Paused", () => {
  const session = createMockSession("paused", { subjectName: "英语阅读" });
  const pool = computeDynamicIslandStatePool({
    activeSession: session,
    offlineSession: null,
    elapsedSeconds: 900,
  });

  assert.equal(pool.activeStates.length, 1);
  assert.equal(pool.hasConcurrency, false);

  const dominant = pool.dominantState;
  assert.equal(dominant.kind, "activity_paused");
  assert.equal(dominant.priorityWeight, PRIORITY_WEIGHTS.activity_paused); // 800
  assert.equal(dominant.accentTone, "amber");
  assert.equal(dominant.title, "英语阅读 暂停中");
  assert.equal(dominant.quickAction?.type, "resume");
  assert.equal(dominant.quickAction?.label, "继续");
  assert.ok(validateStatePoolInvariants(pool));
});

test("M1 Individual State: P3 Recovery Active", () => {
  const recovery: DynamicIslandRecoveryProps = {
    active: true,
    stage: 2,
    targetMinutes: 60,
    reason: "历史低转化",
  };
  const pool = computeDynamicIslandStatePool({
    activeSession: null,
    offlineSession: null,
    recovery,
    elapsedSeconds: 0,
  });

  assert.equal(pool.activeStates.length, 1);
  assert.equal(pool.hasConcurrency, false);

  const dominant = pool.dominantState;
  assert.equal(dominant.kind, "recovery_active");
  assert.equal(dominant.priorityWeight, PRIORITY_WEIGHTS.recovery_active); // 700
  assert.equal(dominant.accentTone, "amber");
  assert.equal(dominant.stage, 2);
  assert.equal(dominant.targetMinutes, 60);
  assert.equal(dominant.reason, "历史低转化");
  assert.equal(dominant.quickAction?.type, "recovery");
  assert.ok(validateStatePoolInvariants(pool));
});

test("M1 Individual State: P3 Recovery Active with missing props defaults safely", () => {
  const pool = computeDynamicIslandStatePool({
    activeSession: null,
    offlineSession: null,
    recovery: { active: true, stage: 0, targetMinutes: 0 },
    elapsedSeconds: 0,
  });

  const dominant = pool.dominantState;
  assert.equal(dominant.kind, "recovery_active");
  assert.equal(dominant.stage, 1);
  assert.equal(dominant.targetMinutes, 30);
  assert.ok(validateStatePoolInvariants(pool));
});

test("M1 Individual State: P4 Evening Review Due", () => {
  const eveningReview: DynamicIslandEveningReviewProps = {
    due: true,
    minimumActionDone: true,
    dailyReviewDone: false,
    reviewHref: "/roadmap/reviews/daily",
  };
  const pool = computeDynamicIslandStatePool({
    activeSession: null,
    offlineSession: null,
    eveningReview,
    elapsedSeconds: 0,
  });

  assert.equal(pool.activeStates.length, 1);
  assert.equal(pool.hasConcurrency, false);

  const dominant = pool.dominantState;
  assert.equal(dominant.kind, "evening_review_due");
  assert.equal(dominant.priorityWeight, PRIORITY_WEIGHTS.evening_review_due); // 600
  assert.equal(dominant.accentTone, "indigo");
  assert.equal(dominant.minimumActionDone, true);
  assert.equal(dominant.dailyReviewDone, false);
  assert.equal(dominant.reviewHref, "/roadmap/reviews/daily");
  assert.equal(dominant.quickAction?.type, "closeout");
  assert.equal(dominant.quickAction?.href, "/roadmap/reviews/daily");
  assert.ok(validateStatePoolInvariants(pool));
});

test("M1 Individual State: P5 Sync Issue across non-current sync states", () => {
  const nonCurrentStates: DynamicIslandSyncState[] = ["deferred", "pending", "offline", "blocked", "unavailable"];
  for (const syncState of nonCurrentStates) {
    const pool = computeDynamicIslandStatePool({
      activeSession: null,
      offlineSession: null,
      syncState,
      elapsedSeconds: 0,
    });

    assert.equal(pool.activeStates.length, 1);
    const dominant = pool.dominantState;
    assert.equal(dominant.kind, "sync_issue");
    assert.equal(dominant.priorityWeight, PRIORITY_WEIGHTS.sync_issue); // 500
    assert.equal(dominant.accentTone, "amber");
    assert.equal(dominant.syncState, syncState);
    assert.equal(dominant.quickAction?.type, "sync");
    assert.equal(dominant.quickAction?.label, "对账");
    assert.ok(validateStatePoolInvariants(pool));
  }
});

test("M1 Individual State: P6 Confirmations Pending", () => {
  const pool = computeDynamicIslandStatePool({
    activeSession: null,
    offlineSession: null,
    pendingConfirmationsCount: 4,
    elapsedSeconds: 0,
  });

  assert.equal(pool.activeStates.length, 1);
  const dominant = pool.dominantState;
  assert.equal(dominant.kind, "confirmations_pending");
  assert.equal(dominant.priorityWeight, PRIORITY_WEIGHTS.confirmations_pending); // 400
  assert.equal(dominant.accentTone, "amber");
  assert.equal(dominant.pendingConfirmationsCount, 4);
  assert.equal(dominant.title, "4项待确认");
  assert.equal(dominant.quickAction?.type, "confirmations");
  assert.ok(validateStatePoolInvariants(pool));
});

test("M1 Individual State: P7 Idle State when empty or syncState is current", () => {
  const poolCurrent = computeDynamicIslandStatePool({
    activeSession: null,
    offlineSession: null,
    syncState: "current",
    recovery: null,
    eveningReview: null,
    pendingConfirmationsCount: 0,
    elapsedSeconds: 0,
  });

  assert.equal(poolCurrent.activeStates.length, 0);
  assert.equal(poolCurrent.hasConcurrency, false);
  assert.equal(poolCurrent.concurrencyCount, 0);
  assert.equal(poolCurrent.dominantState.kind, "idle");
  assert.equal(poolCurrent.dominantState.priorityWeight, 0);
  assert.equal(poolCurrent.dominantState.accentTone, "zinc");
  assert.equal(poolCurrent.dominantState.quickAction?.type, "search");
  assert.ok(validateStatePoolInvariants(poolCurrent));

  const poolEmpty = computeDynamicIslandStatePool({});
  assert.equal(poolEmpty.activeStates.length, 0);
  assert.equal(poolEmpty.dominantState.kind, "idle");
  assert.ok(validateStatePoolInvariants(poolEmpty));
});

// ============================================================================
// SUITE 2: Multi-State Concurrency & Permutation Matrix (2 to 7 States)
// ============================================================================

test("M1 Concurrency: 2-state permutation (Paused P2 + Recovery P3)", () => {
  const pool = computeDynamicIslandStatePool({
    activeSession: createMockSession("paused"),
    offlineSession: null,
    recovery: { active: true, stage: 2, targetMinutes: 60 },
    elapsedSeconds: 600,
  });

  assert.equal(pool.hasConcurrency, true);
  assert.equal(pool.concurrencyCount, 2);
  assert.equal(pool.activeStates.length, 2);

  // Dominant is highest priority (P2 Paused)
  assert.equal(pool.dominantState.kind, "activity_paused");
  assert.equal(pool.dominantState.priorityWeight, 800);

  // Order is strictly descending
  assert.equal(pool.activeStates[0].kind, "activity_paused");
  assert.equal(pool.activeStates[1].kind, "recovery_active");
  assert.ok(validateStatePoolInvariants(pool));
});

test("M1 Concurrency: 3-state permutation (Recovery P3 + Evening P4 + Confirmations P6)", () => {
  const pool = computeDynamicIslandStatePool({
    activeSession: null,
    offlineSession: null,
    recovery: { active: true, stage: 1, targetMinutes: 30 },
    eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
    pendingConfirmationsCount: 2,
    elapsedSeconds: 0,
  });

  assert.equal(pool.hasConcurrency, true);
  assert.equal(pool.concurrencyCount, 3);
  assert.equal(pool.dominantState.kind, "recovery_active");
  assert.deepEqual(
    pool.activeStates.map((s) => s.kind),
    ["recovery_active", "evening_review_due", "confirmations_pending"]
  );
  assert.ok(validateStatePoolInvariants(pool));
});

test("M1 Concurrency: 4-state permutation (Paused P2 + Recovery P3 + Evening P4 + Sync P5)", () => {
  const pool = computeDynamicIslandStatePool({
    activeSession: createMockSession("paused"),
    offlineSession: null,
    recovery: { active: true, stage: 3, targetMinutes: 90 },
    eveningReview: { due: true, minimumActionDone: true, dailyReviewDone: false },
    syncState: "deferred",
    elapsedSeconds: 1200,
  });

  assert.equal(pool.hasConcurrency, true);
  assert.equal(pool.concurrencyCount, 4);
  assert.equal(pool.dominantState.kind, "activity_paused");
  assert.deepEqual(
    pool.activeStates.map((s) => s.kind),
    ["activity_paused", "recovery_active", "evening_review_due", "sync_issue"]
  );
  assert.deepEqual(
    pool.activeStates.map((s) => s.priorityWeight),
    [800, 700, 600, 500]
  );
  assert.ok(validateStatePoolInvariants(pool));
});

test("M1 Concurrency: 5-state permutation (Closing P1 + Recovery P3 + Evening P4 + Sync P5 + Confirmations P6)", () => {
  const pool = computeDynamicIslandStatePool({
    activeSession: createMockSession("closing"),
    offlineSession: null,
    recovery: { active: true, stage: 1, targetMinutes: 30 },
    eveningReview: { due: true, minimumActionDone: true, dailyReviewDone: false },
    syncState: "blocked",
    confirmationsCount: 3,
    elapsedSeconds: 2400,
  });

  assert.equal(pool.hasConcurrency, true);
  assert.equal(pool.concurrencyCount, 5);
  assert.equal(pool.dominantState.kind, "live_session_closing");
  assert.deepEqual(
    pool.activeStates.map((s) => s.kind),
    ["live_session_closing", "recovery_active", "evening_review_due", "sync_issue", "confirmations_pending"]
  );
  assert.deepEqual(
    pool.activeStates.map((s) => s.priorityWeight),
    [900, 700, 600, 500, 400]
  );
  assert.ok(validateStatePoolInvariants(pool));
});

test("M1 Concurrency: Simultaneous active states preserve all items in strict priority order", () => {
  const pool = computeDynamicIslandStatePool({
    activeSession: createMockSession("running"),
    recovery: { active: true, stage: 2, targetMinutes: 60 },
    eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
    syncState: "blocked",
    pendingConfirmationsCount: 5,
    elapsedSeconds: 1800,
  });

  assert.equal(pool.hasConcurrency, true);
  assert.equal(pool.dominantState.kind, "live_session_running");
  assert.equal(pool.dominantState.priorityWeight, 1000);

  const kinds = pool.activeStates.map((s) => s.kind);
  assert.ok(kinds.includes("live_session_running"));
  assert.ok(kinds.includes("recovery_active"));
  assert.ok(kinds.includes("evening_review_due"));
  assert.ok(kinds.includes("sync_issue"));
  assert.ok(kinds.includes("confirmations_pending"));

  for (let i = 0; i < pool.activeStates.length - 1; i++) {
    assert.ok(
      pool.activeStates[i].priorityWeight >= pool.activeStates[i + 1].priorityWeight,
      `State at index ${i} (${pool.activeStates[i].priorityWeight}) must be >= index ${i + 1} (${pool.activeStates[i + 1].priorityWeight})`
    );
  }
  assert.ok(validateStatePoolInvariants(pool));
});

test("M1 Concurrency: Active session takes precedence over offline session if both provided", () => {
  const activeSession = createMockSession("running", { id: "active-s1", subjectName: "高等数学" });
  const offlineSession = createMockSession("paused", { id: "offline-s1", subjectName: "英语阅读" });

  const pool = computeDynamicIslandStatePool({
    activeSession,
    offlineSession,
    elapsedSeconds: 300,
  });

  assert.equal(pool.dominantState.kind, "live_session_running");
  assert.equal(pool.dominantState.session?.id, "active-s1");
  assert.equal(pool.dominantState.title, "高等数学");
});

test("M1 Concurrency: Offline session is promoted when active session is absent", () => {
  const offlineSession = createMockSession("paused", { id: "offline-s1", subjectName: "英语阅读" });

  const pool = computeDynamicIslandStatePool({
    activeSession: null,
    offlineSession,
    elapsedSeconds: 400,
  });

  assert.equal(pool.dominantState.kind, "activity_paused");
  assert.equal(pool.dominantState.session?.id, "offline-s1");
});

// ============================================================================
// SUITE 3: 5,000-Iteration High-Volume Random Fuzzing Invariant Test
// ============================================================================

test("M1 Fuzzing Invariant: 5000 random state permutations satisfy all pool invariants", () => {
  const statuses: Array<"running" | "closing" | "paused" | "completed" | null> = [
    "running",
    "closing",
    "paused",
    "completed",
    null,
  ];
  const syncStates: Array<DynamicIslandSyncState | undefined> = [
    "current",
    "deferred",
    "pending",
    "offline",
    "blocked",
    "unavailable",
    undefined,
  ];
  const booleanChoices = [true, false];
  const confirmationCounts = [-5, 0, 1, 3, 10, null, undefined];

  const ALLOWED_WEIGHTS = new Set([1000, 900, 800, 700, 600, 500, 400, 0]);

  for (let i = 0; i < 5000; i++) {
    const activeStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const offlineStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const activeSession = activeStatus ? createMockSession(activeStatus) : null;
    const offlineSession = offlineStatus ? createMockSession(offlineStatus, { id: "offline-fuzz" }) : null;
    const syncState = syncStates[Math.floor(Math.random() * syncStates.length)];
    const recoveryActive = booleanChoices[Math.floor(Math.random() * booleanChoices.length)];
    const stage = Math.floor(Math.random() * 5);
    const targetMinutes = Math.floor(Math.random() * 120);
    const eveningDue = booleanChoices[Math.floor(Math.random() * booleanChoices.length)];
    const pendingConfirmations = confirmationCounts[Math.floor(Math.random() * confirmationCounts.length)] ?? undefined;
    const elapsed = Math.floor(Math.random() * 7200) - 100;

    const input: CollectDynamicIslandStatesInput = {
      activeSession,
      offlineSession,
      syncState,
      recovery: recoveryActive ? { active: true, stage, targetMinutes, reason: "fuzz" } : null,
      eveningReview: eveningDue ? { due: true, minimumActionDone: false, dailyReviewDone: false } : null,
      pendingConfirmationsCount: pendingConfirmations,
      elapsedSeconds: elapsed,
    };

    const pool = computeDynamicIslandStatePool(input);

    // INVARIANT 1: dominantState is never null or undefined
    assert.ok(pool.dominantState, `Iteration ${i}: dominantState must not be null/undefined`);

    // INVARIANT 2: dominantState matches activeStates[0] if activeStates is non-empty
    if (pool.activeStates.length > 0) {
      assert.equal(
        pool.dominantState.id,
        pool.activeStates[0].id,
        `Iteration ${i}: dominantState must equal activeStates[0]`
      );
      assert.equal(
        pool.dominantState.priorityWeight,
        pool.activeStates[0].priorityWeight,
        `Iteration ${i}: dominantState priority weight must equal activeStates[0] weight`
      );
    } else {
      assert.equal(pool.dominantState.kind, "idle", `Iteration ${i}: empty pool must yield idle dominant state`);
      assert.equal(pool.dominantState.priorityWeight, 0, `Iteration ${i}: idle dominant state must have weight 0`);
    }

    // INVARIANT 3: activeStates is strictly ordered by priority weight descending
    for (let j = 0; j < pool.activeStates.length - 1; j++) {
      assert.ok(
        pool.activeStates[j].priorityWeight >= pool.activeStates[j + 1].priorityWeight,
        `Iteration ${i}: state pool must be sorted descending at index ${j}`
      );
    }

    // INVARIANT 4: No duplicate kinds in activeStates
    const kindSet = new Set<DynamicIslandCapsuleKind>();
    for (const item of pool.activeStates) {
      assert.ok(!kindSet.has(item.kind), `Iteration ${i}: duplicate state kind '${item.kind}' detected in pool`);
      kindSet.add(item.kind);
    }

    // INVARIANT 5: All weights belong to the valid weight domain
    assert.ok(
      ALLOWED_WEIGHTS.has(pool.dominantState.priorityWeight),
      `Iteration ${i}: invalid dominant priority weight ${pool.dominantState.priorityWeight}`
    );
    for (const item of pool.activeStates) {
      assert.ok(
        ALLOWED_WEIGHTS.has(item.priorityWeight),
        `Iteration ${i}: invalid priority weight ${item.priorityWeight} in activeStates`
      );
    }

    // INVARIANT 6: Concurrency count and boolean consistency
    assert.equal(
      pool.concurrencyCount,
      pool.activeStates.length,
      `Iteration ${i}: concurrencyCount must equal activeStates.length`
    );
    assert.equal(
      pool.hasConcurrency,
      pool.activeStates.length > 1,
      `Iteration ${i}: hasConcurrency must be true iff activeStates.length > 1`
    );

    // INVARIANT 7: Pure functional idempotence
    const rerun = computeDynamicIslandStatePool(input);
    assert.deepEqual(pool, rerun, `Iteration ${i}: state collection must be purely idempotent`);
  }
});

// ============================================================================
// SUITE 4: Robustness & Boundary Conditions
// ============================================================================

test("M1 Boundary: Negative elapsed seconds and sub-seconds clamp safely", () => {
  assert.equal(clampTimerDuration(-1), 0);
  assert.equal(clampTimerDuration(-3600), 0);
  assert.equal(clampTimerDuration(NaN), 0);
  assert.equal(clampTimerDuration(Infinity), 0);
  assert.equal(clampTimerDuration(-Infinity), 0);
  assert.equal(clampTimerDuration(0), 0);
  assert.equal(clampTimerDuration(45.7), 45);
  assert.equal(clampTimerDuration(1500), 1500);
});

test("M1 Boundary: Null, undefined, and empty inputs produce valid Idle pool", () => {
  const pool1 = computeDynamicIslandStatePool({
    activeSession: null,
    offlineSession: null,
    syncState: undefined,
    recovery: null,
    eveningReview: null,
    pendingConfirmationsCount: null as unknown as undefined,
    elapsedSeconds: undefined as unknown as number,
  });
  assert.equal(pool1.dominantState.kind, "idle");
  assert.equal(pool1.activeStates.length, 0);

  const pool2 = computeDynamicIslandStatePool({} as CollectDynamicIslandStatesInput);
  assert.equal(pool2.dominantState.kind, "idle");
  assert.equal(pool2.activeStates.length, 0);
});

test("M1 Boundary: Zero or negative confirmation counts do not trigger P6 state", () => {
  const nonTriggerCounts: Array<number | null | undefined> = [0, -1, -99, Number.NaN, null, undefined];
  for (const count of nonTriggerCounts) {
    const pool = computeDynamicIslandStatePool({
      pendingConfirmationsCount: count as number | undefined,
    });
    assert.equal(
      pool.activeStates.some((s) => s.kind === "confirmations_pending"),
      false,
      `Count ${count} must not emit confirmations_pending`
    );
  }
});

test("M1 Boundary: Malformed recovery stages normalize to minimum valid stage", () => {
  const poolNegative = computeDynamicIslandStatePool({
    recovery: { active: true, stage: -5, targetMinutes: -30 },
  });
  assert.equal(poolNegative.dominantState.kind, "recovery_active");
  assert.equal(poolNegative.dominantState.stage, 1);
  assert.equal(poolNegative.dominantState.targetMinutes, 30);
});

test("M1 Helper functions: getPriorityWeight, createIdleStateItem, resolveDominantState, sortActiveStatesByPriority, collectDynamicIslandStatePool", () => {
  assert.equal(getPriorityWeight("live_session_running"), 1000);
  assert.equal(getPriorityWeight("live_session_closing"), 900);
  assert.equal(getPriorityWeight("activity_paused"), 800);
  assert.equal(getPriorityWeight("recovery_active"), 700);
  assert.equal(getPriorityWeight("evening_review_due"), 600);
  assert.equal(getPriorityWeight("sync_issue"), 500);
  assert.equal(getPriorityWeight("confirmations_pending"), 400);
  assert.equal(getPriorityWeight("idle"), 0);

  const idle = createIdleStateItem();
  assert.equal(idle.kind, "idle");
  assert.equal(idle.priorityWeight, 0);

  const dominant = resolveDominantState([]);
  assert.equal(dominant.kind, "idle");
  assert.equal(getDominantState([]).kind, "idle");

  const unsorted = [
    { ...idle, id: "1", priorityWeight: 400 },
    { ...idle, id: "2", priorityWeight: 900 },
  ];
  const sorted = sortActiveStatesByPriority(unsorted);
  assert.equal(sorted[0].priorityWeight, 900);
  assert.equal(sorted[1].priorityWeight, 400);

  const pool = collectDynamicIslandStatePool({});
  assert.equal(pool.dominantState.kind, "idle");
});

test("M1 Backward Compatibility: resolveDynamicIslandState returns compatible DynamicIslandCapsuleState", () => {
  const session = createMockSession("running");
  const legacyState = resolveDynamicIslandState({
    activeSession: session,
    offlineSession: null,
    syncState: "deferred",
    recovery: { active: true, stage: 2, targetMinutes: 60 },
    eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
    elapsedSeconds: 1200,
  });

  assert.equal(legacyState.kind, "live_session_running");
  assert.equal(legacyState.session?.id, "session-m1-test-01");
  assert.equal(legacyState.elapsedSeconds, 1200);
});

// ============================================================================
// SUITE 5: State Machine Lifecycle Transitions
// ============================================================================

test("M1 Lifecycle Simulation: Day flow through multiple concurrent states", () => {
  let activeSession: StudySessionDto | null = null;
  let syncState: DynamicIslandSyncState = "current";
  let recovery: DynamicIslandRecoveryProps | null = null;
  let eveningReview: DynamicIslandEveningReviewProps | null = null;
  const confirmationsCount = 0;

  // 1. Morning Idle (P7)
  let pool = computeDynamicIslandStatePool({ activeSession, syncState, recovery, eveningReview, pendingConfirmationsCount: confirmationsCount });
  assert.equal(pool.dominantState.kind, "idle");
  assert.equal(pool.activeStates.length, 0);

  // 2. Supervisor flags Recovery Mode (P3)
  recovery = { active: true, stage: 1, targetMinutes: 30, reason: "连续低转化" };
  pool = computeDynamicIslandStatePool({ activeSession, syncState, recovery, eveningReview, pendingConfirmationsCount: confirmationsCount });
  assert.equal(pool.dominantState.kind, "recovery_active");
  assert.equal(pool.activeStates.length, 1);

  // 3. User starts Higher Math session -> P0 preempts P3, 2 concurrent states
  activeSession = createMockSession("running", { id: "s-math", subjectName: "高等数学" });
  pool = computeDynamicIslandStatePool({ activeSession, syncState, recovery, eveningReview, pendingConfirmationsCount: confirmationsCount, elapsedSeconds: 300 });
  assert.equal(pool.dominantState.kind, "live_session_running");
  assert.equal(pool.hasConcurrency, true);
  assert.equal(pool.concurrencyCount, 2);
  assert.deepEqual(pool.activeStates.map((s) => s.kind), ["live_session_running", "recovery_active"]);

  // 4. User pauses session -> P2 Paused + P3 Recovery, 2 concurrent states
  activeSession = createMockSession("paused", { id: "s-math", subjectName: "高等数学" });
  pool = computeDynamicIslandStatePool({ activeSession, syncState, recovery, eveningReview, pendingConfirmationsCount: confirmationsCount, elapsedSeconds: 900 });
  assert.equal(pool.dominantState.kind, "activity_paused");
  assert.equal(pool.hasConcurrency, true);

  // 5. 20:00 Nightly review becomes due -> P2 Paused + P3 Recovery + P4 Evening Due (3 states)
  eveningReview = { due: true, minimumActionDone: true, dailyReviewDone: false };
  pool = computeDynamicIslandStatePool({ activeSession, syncState, recovery, eveningReview, pendingConfirmationsCount: confirmationsCount, elapsedSeconds: 900 });
  assert.equal(pool.dominantState.kind, "activity_paused");
  assert.equal(pool.concurrencyCount, 3);
  assert.deepEqual(pool.activeStates.map((s) => s.kind), ["activity_paused", "recovery_active", "evening_review_due"]);

  // 6. Network drops -> P5 Sync Issue added (4 states)
  syncState = "offline";
  pool = computeDynamicIslandStatePool({ activeSession, syncState, recovery, eveningReview, pendingConfirmationsCount: confirmationsCount, elapsedSeconds: 900 });
  assert.equal(pool.concurrencyCount, 4);
  assert.deepEqual(pool.activeStates.map((s) => s.kind), ["activity_paused", "recovery_active", "evening_review_due", "sync_issue"]);

  // 7. User clicks Instant Resume -> P0 Running preempts all (4 states, P0 dominant)
  activeSession = createMockSession("running", { id: "s-math", subjectName: "高等数学" });
  pool = computeDynamicIslandStatePool({ activeSession, syncState, recovery, eveningReview, pendingConfirmationsCount: confirmationsCount, elapsedSeconds: 1500 });
  assert.equal(pool.dominantState.kind, "live_session_running");

  // 8. User closes study session -> P1 Closing
  activeSession = createMockSession("closing", { id: "s-math", subjectName: "高等数学" });
  pool = computeDynamicIslandStatePool({ activeSession, syncState, recovery, eveningReview, pendingConfirmationsCount: confirmationsCount, elapsedSeconds: 1800 });
  assert.equal(pool.dominantState.kind, "live_session_closing");

  // 9. Session completed -> drops session, P3 Recovery becomes dominant (3 states)
  activeSession = null;
  pool = computeDynamicIslandStatePool({ activeSession, syncState, recovery, eveningReview, pendingConfirmationsCount: confirmationsCount });
  assert.equal(pool.dominantState.kind, "recovery_active");

  // 10. Recovery completed -> P4 Evening Due becomes dominant (2 states)
  recovery = { active: false, stage: 1, targetMinutes: 30 };
  pool = computeDynamicIslandStatePool({ activeSession, syncState, recovery, eveningReview, pendingConfirmationsCount: confirmationsCount });
  assert.equal(pool.dominantState.kind, "evening_review_due");

  // 11. Daily review submitted -> P5 Sync Issue becomes dominant (1 state)
  eveningReview = { due: false, minimumActionDone: true, dailyReviewDone: true };
  pool = computeDynamicIslandStatePool({ activeSession, syncState, recovery, eveningReview, pendingConfirmationsCount: confirmationsCount });
  assert.equal(pool.dominantState.kind, "sync_issue");

  // 12. Offline queue reconciled -> Returns to P7 Idle (0 states)
  syncState = "current";
  pool = computeDynamicIslandStatePool({ activeSession, syncState, recovery, eveningReview, pendingConfirmationsCount: confirmationsCount });
  assert.equal(pool.dominantState.kind, "idle");
  assert.equal(pool.activeStates.length, 0);
  assert.equal(pool.hasConcurrency, false);
});

// ============================================================================
// SUITE 6: Route Anti-Redundancy Suppression Engine (R1)
// ============================================================================

test("M1 Route Suppression: /focus suppresses running, closing, and paused stopwatch sessions", () => {
  assert.equal(isStateSuppressedOnRoute("live_session_running", "/focus"), true);
  assert.equal(isStateSuppressedOnRoute("live_session_closing", "/focus"), true);
  assert.equal(isStateSuppressedOnRoute("activity_paused", "/focus"), true);
  assert.equal(isStateSuppressedOnRoute("recovery_active", "/focus"), false);
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "/focus"), false);
  assert.equal(isStateSuppressedOnRoute("sync_issue", "/focus"), false);
  assert.equal(isStateSuppressedOnRoute("confirmations_pending", "/focus"), false);
  assert.equal(isStateSuppressedOnRoute("idle", "/focus"), false);
});

test("M1 Route Suppression: /focus returns idle when only running session exists", () => {
  const session = createMockSession("running");
  const pool = computeDynamicIslandStatePool({
    activeSession: session,
    pathname: "/focus",
  });

  assert.equal(pool.activeStates.length, 0);
  assert.equal(pool.dominantState.kind, "idle");
  assert.equal(pool.hasConcurrency, false);
});

test("M1 Route Suppression: /focus falls back to recovery_active when running session and recovery coexist", () => {
  const session = createMockSession("running");
  const pool = computeDynamicIslandStatePool({
    activeSession: session,
    recovery: { active: true, stage: 2, targetMinutes: 60 },
    pathname: "/focus",
  });

  assert.equal(pool.activeStates.length, 1);
  assert.equal(pool.dominantState.kind, "recovery_active");
  assert.equal(pool.dominantState.priorityWeight, 700);
});

test("M1 Route Suppression: /focus falls back to evening_review_due when running session and evening review coexist", () => {
  const session = createMockSession("running");
  const pool = computeDynamicIslandStatePool({
    activeSession: session,
    eveningReview: { due: true, minimumActionDone: true, dailyReviewDone: false },
    pathname: "/focus",
  });

  assert.equal(pool.activeStates.length, 1);
  assert.equal(pool.dominantState.kind, "evening_review_due");
  assert.equal(pool.dominantState.priorityWeight, 600);
});

test("M1 Route Suppression: /today suppresses recovery_active while keeping stopwatch and evening review", () => {
  assert.equal(isStateSuppressedOnRoute("recovery_active", "/today"), true);
  assert.equal(isStateSuppressedOnRoute("live_session_running", "/today"), false);
  assert.equal(isStateSuppressedOnRoute("live_session_closing", "/today"), false);
  assert.equal(isStateSuppressedOnRoute("activity_paused", "/today"), false);
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "/today"), false);
  assert.equal(isStateSuppressedOnRoute("sync_issue", "/today"), false);
});

test("M1 Route Suppression: /today returns idle when only recovery mode is active", () => {
  const pool = computeDynamicIslandStatePool({
    recovery: { active: true, stage: 1, targetMinutes: 30 },
    pathname: "/today",
  });

  assert.equal(pool.activeStates.length, 0);
  assert.equal(pool.dominantState.kind, "idle");
});

test("M1 Route Suppression: /today preserves live running session when running and recovery coexist", () => {
  const session = createMockSession("running");
  const pool = computeDynamicIslandStatePool({
    activeSession: session,
    recovery: { active: true, stage: 1, targetMinutes: 30 },
    pathname: "/today",
  });

  assert.equal(pool.activeStates.length, 1);
  assert.equal(pool.dominantState.kind, "live_session_running");
  assert.equal(pool.dominantState.priorityWeight, 1000);
});

test("M1 Route Suppression: /roadmap/reviews and subpaths suppress evening_review_due", () => {
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "/roadmap/reviews"), true);
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "/roadmap/reviews/daily"), true);
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "/roadmap/reviews/weekly"), true);
  assert.equal(isStateSuppressedOnRoute("live_session_running", "/roadmap/reviews"), false);
  assert.equal(isStateSuppressedOnRoute("recovery_active", "/roadmap/reviews"), false);
});

test("M1 Route Suppression: /roadmap/reviews returns idle when only evening review is due", () => {
  const pool = computeDynamicIslandStatePool({
    eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
    pathname: "/roadmap/reviews",
  });

  assert.equal(pool.activeStates.length, 0);
  assert.equal(pool.dominantState.kind, "idle");
});

test("M1 Route Suppression: Neutral routes (/dashboard, /tasks, /, null) suppress no states", () => {
  const neutralPaths = ["/", "/dashboard", "/tasks", "/syllabus", "/analytics", "/settings", null, undefined, ""];
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

  for (const pathname of neutralPaths) {
    for (const kind of allKinds) {
      assert.equal(
        isStateSuppressedOnRoute(kind, pathname),
        false,
        `Kind ${kind} must NOT be suppressed on neutral route ${pathname}`
      );
    }
  }
});

test("M1 Route Suppression: Path matching normalizes trailing slashes, query strings, and hashes safely", () => {
  assert.equal(isStateSuppressedOnRoute("live_session_running", "/focus/"), true);
  assert.equal(isStateSuppressedOnRoute("live_session_running", "/focus?view=compact#timer"), true);
  assert.equal(isStateSuppressedOnRoute("live_session_running", "/focus-workbench"), false);
  assert.equal(isStateSuppressedOnRoute("recovery_active", "/today/action-1?step=2"), true);
  assert.equal(isStateSuppressedOnRoute("recovery_active", "/today-review"), false);
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "/roadmap/reviews/daily?mode=strict"), true);
  assert.equal(isStateSuppressedOnRoute("evening_review_due", "/roadmap/reviews-archive"), false);
});

test("M1 Route Suppression: filterStatesByRouteContext removes suppressed states correctly", () => {
  const session = createMockSession("running");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 1, targetMinutes: 30 };
  const rawStates = collectDynamicIslandActiveStates({ activeSession: session, recovery });

  const onFocus = filterStatesByRouteContext(rawStates, "/focus");
  assert.equal(onFocus.length, 1);
  assert.equal(onFocus[0].kind, "recovery_active");

  const onToday = filterStatesByRouteContext(rawStates, "/today");
  assert.equal(onToday.length, 1);
  assert.equal(onToday[0].kind, "live_session_running");

  const onDashboard = filterStatesByRouteContext(rawStates, "/dashboard");
  assert.equal(onDashboard.length, 2);

  const empty = filterStatesByRouteContext([], "/dashboard");
  assert.deepEqual(empty, []);
});

// ============================================================================
// SUITE 7: Dual-Task State Resolution Engine & Fluid Swap (R2)
// ============================================================================

test("M1 Dual-Task: [live_session_running, recovery_active] on /dashboard resolves dominant=running, satellite=recovery", () => {
  const session = createMockSession("running");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 2, targetMinutes: 60 };

  const dual = resolveDualTaskStates(
    collectDynamicIslandActiveStates({ activeSession: session, recovery }),
    "/dashboard"
  );

  assert.equal(dual.dominant.kind, "live_session_running");
  assert.equal(dual.dominant.priorityWeight, 1000);
  assert.ok(dual.satellite);
  assert.equal(dual.satellite?.kind, "recovery_active");
  assert.equal(dual.satellite?.priorityWeight, 700);
  assert.equal(dual.allUnsuppressed.length, 2);
});

test("M1 Dual-Task: [live_session_running, recovery_active] on /focus resolves dominant=recovery, satellite=null", () => {
  const session = createMockSession("running");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 1, targetMinutes: 30 };

  const dual = resolveDualTaskStates(
    collectDynamicIslandActiveStates({ activeSession: session, recovery }),
    "/focus"
  );

  assert.equal(dual.dominant.kind, "recovery_active");
  assert.equal(dual.dominant.priorityWeight, 700);
  assert.equal(dual.satellite, null, "Stopwatch is suppressed on /focus, leaving only 1 state -> satellite must be null");
  assert.equal(dual.allUnsuppressed.length, 1);
});

test("M1 Dual-Task: [live_session_running, recovery_active] on /today resolves dominant=running, satellite=null", () => {
  const session = createMockSession("running");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 1, targetMinutes: 30 };

  const dual = resolveDualTaskStates(
    collectDynamicIslandActiveStates({ activeSession: session, recovery }),
    "/today"
  );

  assert.equal(dual.dominant.kind, "live_session_running");
  assert.equal(dual.dominant.priorityWeight, 1000);
  assert.equal(dual.satellite, null, "Recovery is suppressed on /today, leaving only 1 state -> satellite must be null");
  assert.equal(dual.allUnsuppressed.length, 1);
});

test("M1 Dual-Task: [running, recovery, evening] on /dashboard resolves dominant=running, satellite=recovery, allUnsuppressed.length=3", () => {
  const session = createMockSession("running");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 1, targetMinutes: 30 };
  const eveningReview: DynamicIslandEveningReviewProps = { due: true, minimumActionDone: false, dailyReviewDone: false };

  const dual = resolveDualTaskStates(
    collectDynamicIslandActiveStates({ activeSession: session, recovery, eveningReview }),
    "/dashboard"
  );

  assert.equal(dual.allUnsuppressed.length, 3);
  assert.equal(dual.dominant.kind, "live_session_running");
  assert.equal(dual.satellite?.kind, "recovery_active");
});

test("M1 Dual-Task: Fluid Swap with swappedPrimaryKind promotes satellite to dominant correctly", () => {
  const session = createMockSession("running");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 2, targetMinutes: 60 };

  const dualSwapped = resolveDualTaskStates(
    collectDynamicIslandActiveStates({ activeSession: session, recovery }),
    "/dashboard",
    "recovery_active" // user clicked satellite bubble
  );

  // Dominant is promoted to recovery_active
  assert.equal(dualSwapped.dominant.kind, "recovery_active");
  assert.equal(dualSwapped.dominant.priorityWeight, 700);

  // Satellite is demoted to live_session_running
  assert.ok(dualSwapped.satellite);
  assert.equal(dualSwapped.satellite?.kind, "live_session_running");
  assert.equal(dualSwapped.satellite?.priorityWeight, 1000);
});

test("M1 Dual-Task: Fluid Swap with 3 states promotes selected satellite and assigns default primary as satellite", () => {
  const session = createMockSession("running");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 2, targetMinutes: 60 };
  const eveningReview: DynamicIslandEveningReviewProps = { due: true, minimumActionDone: true, dailyReviewDone: false };

  const dual = resolveDualTaskStates(
    collectDynamicIslandActiveStates({ activeSession: session, recovery, eveningReview }),
    "/dashboard",
    "evening_review_due"
  );

  assert.equal(dual.dominant.kind, "evening_review_due");
  assert.equal(dual.satellite?.kind, "live_session_running");
});

test("M1 Dual-Task: Invalid swappedPrimaryKind degrades safely to default priority dominant", () => {
  const session = createMockSession("running");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 1, targetMinutes: 30 };

  const dual = resolveDualTaskStates(
    collectDynamicIslandActiveStates({ activeSession: session, recovery }),
    "/dashboard",
    "sync_issue" // not present in active states
  );

  assert.equal(dual.dominant.kind, "live_session_running");
  assert.equal(dual.satellite?.kind, "recovery_active");
});

test("M1 Dual-Task: Single state or empty pool ignores swappedPrimaryKind and keeps satellite null", () => {
  const session = createMockSession("running");

  const dualSingle = resolveDualTaskStates(
    collectDynamicIslandActiveStates({ activeSession: session }),
    "/dashboard",
    "recovery_active"
  );
  assert.equal(dualSingle.dominant.kind, "live_session_running");
  assert.equal(dualSingle.satellite, null);

  const dualEmpty = resolveDualTaskStates([], "/dashboard", "live_session_running");
  assert.equal(dualEmpty.dominant.kind, "idle");
  assert.equal(dualEmpty.satellite, null);
});

// ============================================================================
// SUITE 8: State-Synced Dynamic Aura Theme & Default Tab Mapping (R3)
// ============================================================================

test("M1 Dynamic Aura: State kind to Aura theme mapping (indigo, amber, teal, silver)", () => {
  assert.equal(getAuraThemeForStateKind("evening_review_due"), "indigo");
  assert.equal(getAuraThemeForStateKind("recovery_active"), "amber");
  assert.equal(getAuraThemeForStateKind("live_session_running"), "teal");
  assert.equal(getAuraThemeForStateKind("live_session_closing"), "teal");
  assert.equal(getAuraThemeForStateKind("activity_paused"), "teal");
  assert.equal(getAuraThemeForStateKind("sync_issue"), "amber");
  assert.equal(getAuraThemeForStateKind("confirmations_pending"), "amber");
  assert.equal(getAuraThemeForStateKind("idle"), "silver");
  assert.equal(getAuraThemeForStateKind("command_search"), "silver");
  assert.equal(getAuraThemeForStateKind("unknown_state" as DynamicIslandCapsuleKind), "silver");
  assert.equal(getAuraThemeFromKind("evening_review_due"), "indigo");
});

test("M1 Dynamic Aura: State kind to default hub tab mapping (evening, status, stopwatch, search)", () => {
  assert.equal(getDefaultTabForStateKind("evening_review_due"), "evening");
  assert.equal(getDefaultTabForStateKind("recovery_active"), "status");
  assert.equal(getDefaultTabForStateKind("live_session_running"), "stopwatch");
  assert.equal(getDefaultTabForStateKind("live_session_closing"), "stopwatch");
  assert.equal(getDefaultTabForStateKind("activity_paused"), "stopwatch");
  assert.equal(getDefaultTabForStateKind("sync_issue"), "status");
  assert.equal(getDefaultTabForStateKind("confirmations_pending"), "status");
  assert.equal(getDefaultTabForStateKind("idle"), "search");
  assert.equal(getDefaultTabForStateKind("command_search"), "search");
  assert.equal(getDefaultHubTabForKind("evening_review_due"), "evening");
});

test("M1 Dynamic Aura: Style tokens contain valid border, shadow, and button classes per theme", () => {
  const indigoSpec = getAuraStyles("indigo");
  assert.match(indigoSpec.borderClass, /border-indigo/);
  assert.match(indigoSpec.shadowAura, /rgba\(99,\s*102,\s*241/);
  assert.match(indigoSpec.accentButton, /bg-indigo-500/);

  const amberSpec = getAuraStyles("amber");
  assert.match(amberSpec.borderClass, /border-amber/);
  assert.match(amberSpec.shadowAura, /rgba\(245,\s*158,\s*11/);
  assert.match(amberSpec.accentButton, /bg-amber-500/);

  const tealSpec = getAuraStyles("teal");
  assert.match(tealSpec.borderClass, /border-teal/);
  assert.match(tealSpec.shadowAura, /rgba\(20,\s*184,\s*166/);
  assert.match(tealSpec.accentButton, /bg-teal-500/);

  const silverSpec = getAuraStyles("silver");
  assert.match(silverSpec.borderClass, /border-white\/10/);

  assert.equal(DYNAMIC_ISLAND_AURA_THEMES.indigo.theme, "indigo");
  assert.equal(DYNAMIC_ISLAND_AURA_THEMES.amber.theme, "amber");
  assert.equal(DYNAMIC_ISLAND_AURA_THEMES.teal.theme, "teal");
  assert.equal(DYNAMIC_ISLAND_AURA_THEMES.silver.theme, "silver");
});

// ============================================================================
// SUITE 9: Route-Aware Lifecycle Transitions & 5,000-Iteration Fuzzing Invariants
// ============================================================================

test("M1 Route Lifecycle: User navigates across /focus, /today, /roadmap/reviews, and /dashboard with active states", () => {
  const session = createMockSession("running");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 1, targetMinutes: 30 };
  const eveningReview: DynamicIslandEveningReviewProps = { due: true, minimumActionDone: true, dailyReviewDone: false };

  const rawStates = collectDynamicIslandActiveStates({
    activeSession: session,
    recovery,
    eveningReview,
  });

  // 1. User on /dashboard: all 3 unsuppressed, dominant = running, satellite = recovery
  const dashDual = resolveDualTaskStates(rawStates, "/dashboard");
  assert.equal(dashDual.allUnsuppressed.length, 3);
  assert.equal(dashDual.dominant.kind, "live_session_running");
  assert.equal(dashDual.satellite?.kind, "recovery_active");

  // 2. User navigates to /focus: stopwatch suppressed -> dominant = recovery, satellite = evening
  const focusDual = resolveDualTaskStates(rawStates, "/focus");
  assert.equal(focusDual.allUnsuppressed.length, 2);
  assert.equal(focusDual.dominant.kind, "recovery_active");
  assert.equal(focusDual.satellite?.kind, "evening_review_due");

  // 3. User navigates to /today: recovery suppressed -> dominant = running, satellite = evening
  const todayDual = resolveDualTaskStates(rawStates, "/today");
  assert.equal(todayDual.allUnsuppressed.length, 2);
  assert.equal(todayDual.dominant.kind, "live_session_running");
  assert.equal(todayDual.satellite?.kind, "evening_review_due");

  // 4. User navigates to /roadmap/reviews: evening suppressed -> dominant = running, satellite = recovery
  const reviewDual = resolveDualTaskStates(rawStates, "/roadmap/reviews");
  assert.equal(reviewDual.allUnsuppressed.length, 2);
  assert.equal(reviewDual.dominant.kind, "live_session_running");
  assert.equal(reviewDual.satellite?.kind, "recovery_active");
});

test("M1 Fuzzing Invariant: 5000 random multi-route permutations satisfy all dual-task invariants", () => {
  const routes = [
    "/focus",
    "/focus/",
    "/focus?view=compact",
    "/today",
    "/today/action-1",
    "/roadmap/reviews",
    "/roadmap/reviews/daily",
    "/dashboard",
    "/tasks",
    "/syllabus",
    "/",
    null,
    undefined,
  ];

  const statuses: Array<"running" | "closing" | "paused" | "completed" | null> = [
    "running",
    "closing",
    "paused",
    "completed",
    null,
  ];
  const syncStates: Array<DynamicIslandSyncState | undefined> = [
    "current",
    "deferred",
    "pending",
    "offline",
    "blocked",
    "unavailable",
    undefined,
  ];
  const booleanChoices = [true, false];
  const confirmationCounts = [0, 1, 3, null, undefined];

  for (let i = 0; i < 5000; i++) {
    const route = routes[Math.floor(Math.random() * routes.length)];
    const activeStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const activeSession = activeStatus ? createMockSession(activeStatus) : null;
    const syncState = syncStates[Math.floor(Math.random() * syncStates.length)];
    const recoveryActive = booleanChoices[Math.floor(Math.random() * booleanChoices.length)];
    const eveningDue = booleanChoices[Math.floor(Math.random() * booleanChoices.length)];
    const pendingConfirmations = confirmationCounts[Math.floor(Math.random() * confirmationCounts.length)] ?? undefined;

    const rawStates = collectDynamicIslandActiveStates({
      activeSession,
      syncState,
      recovery: recoveryActive ? { active: true, stage: 1, targetMinutes: 30 } : null,
      eveningReview: eveningDue ? { due: true, minimumActionDone: false, dailyReviewDone: false } : null,
      pendingConfirmationsCount: pendingConfirmations,
    });

    const dual = resolveDualTaskStates(rawStates, route);

    // INVARIANT 1: dominant is ALWAYS non-null and defined
    assert.ok(dual.dominant, `Iteration ${i}: dominant must not be null/undefined`);

    // INVARIANT 2: If allUnsuppressed.length === 0 -> dominant is idle and satellite is null
    if (dual.allUnsuppressed.length === 0) {
      assert.equal(dual.dominant.kind, "idle", `Iteration ${i}: empty unsuppressed pool must yield idle dominant`);
      assert.equal(dual.satellite, null, `Iteration ${i}: empty unsuppressed pool must have null satellite`);
    }

    // INVARIANT 3: If allUnsuppressed.length === 1 -> dominant is item 0 and satellite is null
    if (dual.allUnsuppressed.length === 1) {
      assert.equal(dual.dominant.id, dual.allUnsuppressed[0].id, `Iteration ${i}: 1 state must be dominant`);
      assert.equal(dual.satellite, null, `Iteration ${i}: 1 state must have null satellite`);
    }

    // INVARIANT 4: If allUnsuppressed.length >= 2 -> dominant and satellite are non-null and distinct
    if (dual.allUnsuppressed.length >= 2) {
      assert.ok(dual.satellite, `Iteration ${i}: >=2 states must have satellite`);
      assert.notEqual(dual.dominant.id, dual.satellite?.id, `Iteration ${i}: dominant and satellite must have different ids`);
      assert.ok(
        dual.allUnsuppressed.some((s) => s.id === dual.dominant.id),
        `Iteration ${i}: dominant must belong to unsuppressed states`
      );
      assert.ok(
        dual.allUnsuppressed.some((s) => s.id === dual.satellite?.id),
        `Iteration ${i}: satellite must belong to unsuppressed states`
      );
    }

    // INVARIANT 5: Neither dominant nor satellite (if present) is suppressed on the current route
    if (dual.dominant.kind !== "idle") {
      assert.equal(
        isStateSuppressedOnRoute(dual.dominant.kind, route),
        false,
        `Iteration ${i}: dominant kind '${dual.dominant.kind}' was illegally present on route '${route}'`
      );
    }
    if (dual.satellite) {
      assert.equal(
        isStateSuppressedOnRoute(dual.satellite.kind, route),
        false,
        `Iteration ${i}: satellite kind '${dual.satellite.kind}' was illegally present on route '${route}'`
      );
    }

    // INVARIANT 6: Pure functional idempotence
    const rerun = resolveDualTaskStates(rawStates, route);
    assert.deepEqual(dual, rerun, `Iteration ${i}: resolveDualTaskStates must be purely idempotent`);
  }
});

