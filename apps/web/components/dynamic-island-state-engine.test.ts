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
} from "./dynamic-island-state-engine";
import {
  PRIORITY_WEIGHTS,
  type DynamicIslandCapsuleKind,
  type DynamicIslandActiveItem,
  type DynamicIslandStatePool,
  type DynamicIslandRecoveryProps,
  type DynamicIslandEveningReviewProps,
  type DynamicIslandSyncState,
  type CollectDynamicIslandStatesInput,
  type DynamicIslandStateEngineInput,
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

test("M1 Helper functions: getPriorityWeight, createIdleStateItem, resolveDominantState", () => {
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
