import test from "node:test";
import assert from "node:assert/strict";
import {
  collectDynamicIslandActiveStates,
  sortActiveStatesByPriority,
  computeDynamicIslandStatePool,
  validateStatePoolInvariants,
  filterStatesByRouteContext,
  resolveDualTaskStates,
} from "./dynamic-island-state-engine";
import {
  getAuraThemeForStateKind,
  getDefaultTabForStateKind,
  getAuraStyles,
  getExpandedHubAuraClass,
  getSatelliteBubbleGlowClass,
} from "./dynamic-island-glow";
import type {
  DynamicIslandCapsuleKind,
  DynamicIslandRecoveryProps,
  DynamicIslandEveningReviewProps,
  DynamicIslandSyncState,
  CollectDynamicIslandStatesInput,
  DualTaskResolutionResult,
} from "./dynamic-island-types";
import type { StudySessionDto } from "@/lib/contracts";

function createMockSession(
  status: "running" | "paused" | "closing" | "completed",
  overrides?: Partial<StudySessionDto>
): StudySessionDto {
  return {
    id: "session-stress-01",
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

const STOPWATCH_KINDS: ReadonlySet<DynamicIslandCapsuleKind> = new Set([
  "live_session_running",
  "live_session_closing",
  "activity_paused",
]);

// ============================================================================
// CHALLENGE SUITE 1: 10,000 Iteration Property-Based Randomized Fuzzing
// ============================================================================

test("M1 Challenger Stress: 10,000 randomized permutations satisfy all dual-task & route invariants", () => {
  const routes = [
    "/focus",
    "/focus/",
    "/focus/deep-work",
    "/focus?view=compact",
    "/focus#timer",
    "/today",
    "/today/",
    "/today/action-plan",
    "/today?tab=recovery",
    "/roadmap/reviews",
    "/roadmap/reviews/",
    "/roadmap/reviews/daily",
    "/roadmap/reviews/weekly?strict=true",
    "/dashboard",
    "/tasks",
    "/syllabus",
    "/analytics",
    "/settings",
    "/",
    "",
    null,
    undefined,
  ];

  const sessionStatuses: Array<"running" | "closing" | "paused" | "completed" | null | undefined> = [
    "running",
    "closing",
    "paused",
    "completed",
    null,
    undefined,
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

  const bools = [true, false, null, undefined];
  const confirmationCounts: Array<number | null | undefined> = [
    -100, -1, 0, 1, 2, 5, 99, null, undefined,
  ];
  const elapsedVariants: Array<number | undefined> = [
    -1000, -1, 0, 0.5, 45.7, 1500, 999999, undefined,
  ];

  const allPossibleKinds: DynamicIslandCapsuleKind[] = [
    "live_session_running",
    "live_session_closing",
    "activity_paused",
    "recovery_active",
    "evening_review_due",
    "sync_issue",
    "confirmations_pending",
  ];

  const startTime = performance.now();

  for (let i = 0; i < 10000; i++) {
    const route = routes[Math.floor(Math.random() * routes.length)];
    const activeSt = sessionStatuses[Math.floor(Math.random() * sessionStatuses.length)];
    const offlineSt = sessionStatuses[Math.floor(Math.random() * sessionStatuses.length)];
    const activeSession = activeSt ? createMockSession(activeSt, { id: `act-${i}` }) : null;
    const offlineSession = offlineSt ? createMockSession(offlineSt, { id: `off-${i}` }) : null;

    const syncState = syncStates[Math.floor(Math.random() * syncStates.length)];
    const recActive = bools[Math.floor(Math.random() * bools.length)];
    const stage = Math.floor(Math.random() * 10) - 3;
    const targetMin = Math.floor(Math.random() * 200) - 50;
    const eveningDue = bools[Math.floor(Math.random() * bools.length)];
    const minActionDone = bools[Math.floor(Math.random() * bools.length)];
    const dailyReviewDone = bools[Math.floor(Math.random() * bools.length)];
    const pendingConf = confirmationCounts[Math.floor(Math.random() * confirmationCounts.length)];
    const elapsed = elapsedVariants[Math.floor(Math.random() * elapsedVariants.length)];

    const swapTarget = Math.random() < 0.3
      ? allPossibleKinds[Math.floor(Math.random() * allPossibleKinds.length)]
      : null;

    const rawStates = collectDynamicIslandActiveStates({
      activeSession,
      offlineSession,
      syncState,
      recovery: recActive
        ? {
            active: Boolean(recActive),
            stage,
            targetMinutes: targetMin,
            reason: `fuzz-reason-${i}`,
          }
        : null,
      eveningReview: eveningDue
        ? {
            due: Boolean(eveningDue),
            minimumActionDone: Boolean(minActionDone),
            dailyReviewDone: Boolean(dailyReviewDone),
          }
        : null,
      pendingConfirmationsCount: pendingConf as number | undefined,
      elapsedSeconds: elapsed,
    });

    // Compute dual task resolution
    const dual: DualTaskResolutionResult = resolveDualTaskStates(rawStates, route, swapTarget);

    // INVARIANT 1: dominant is ALWAYS non-null and defined
    assert.ok(dual.dominant, `Iteration ${i}: dominant state must not be null/undefined`);

    // INVARIANT 2: Clean path extraction & Route Suppression Invariants
    const cleanRoute = (route || "").split("?")[0].split("#")[0].trim().replace(/\/+$/, "") || "/";

    // Invariant 2.1: On /focus, no stopwatch states ever appear in dominant or satellite
    if (cleanRoute === "/focus" || cleanRoute.startsWith("/focus/")) {
      assert.strictEqual(
        STOPWATCH_KINDS.has(dual.dominant.kind),
        false,
        `Iteration ${i}: Stopwatch state '${dual.dominant.kind}' illegally appeared as dominant on /focus`
      );
      if (dual.satellite) {
        assert.strictEqual(
          STOPWATCH_KINDS.has(dual.satellite.kind),
          false,
          `Iteration ${i}: Stopwatch state '${dual.satellite.kind}' illegally appeared as satellite on /focus`
        );
      }
      for (const item of dual.allUnsuppressed) {
        assert.strictEqual(
          STOPWATCH_KINDS.has(item.kind),
          false,
          `Iteration ${i}: Stopwatch state '${item.kind}' illegally retained in allUnsuppressed on /focus`
        );
      }
    }

    // Invariant 2.2: On /today, no recovery states ever appear in dominant or satellite
    if (cleanRoute === "/today" || cleanRoute.startsWith("/today/")) {
      assert.notStrictEqual(
        dual.dominant.kind,
        "recovery_active",
        `Iteration ${i}: recovery_active illegally appeared as dominant on /today`
      );
      if (dual.satellite) {
        assert.notStrictEqual(
          dual.satellite.kind,
          "recovery_active",
          `Iteration ${i}: recovery_active illegally appeared as satellite on /today`
        );
      }
      for (const item of dual.allUnsuppressed) {
        assert.notStrictEqual(
          item.kind,
          "recovery_active",
          `Iteration ${i}: recovery_active illegally retained in allUnsuppressed on /today`
        );
      }
    }

    // Invariant 2.3: On /roadmap/reviews, no evening review states ever appear in dominant or satellite
    if (cleanRoute === "/roadmap/reviews" || cleanRoute.startsWith("/roadmap/reviews/")) {
      assert.notStrictEqual(
        dual.dominant.kind,
        "evening_review_due",
        `Iteration ${i}: evening_review_due illegally appeared as dominant on /roadmap/reviews`
      );
      if (dual.satellite) {
        assert.notStrictEqual(
          dual.satellite.kind,
          "evening_review_due",
          `Iteration ${i}: evening_review_due illegally appeared as satellite on /roadmap/reviews`
        );
      }
      for (const item of dual.allUnsuppressed) {
        assert.notStrictEqual(
          item.kind,
          "evening_review_due",
          `Iteration ${i}: evening_review_due illegally retained in allUnsuppressed on /roadmap/reviews`
        );
      }
    }

    // INVARIANT 3: Cardinality & Satellite Assignment Invariants
    const unsuppressed = filterStatesByRouteContext(rawStates, route);
    const sortedUnsuppressed = sortActiveStatesByPriority(unsuppressed);
    const count = sortedUnsuppressed.length;

    assert.strictEqual(dual.allUnsuppressed.length, count, `Iteration ${i}: allUnsuppressed count mismatch`);

    // Invariant 3.1: 0 unsuppressed states -> dominant is idle, satellite is null
    if (count === 0) {
      assert.strictEqual(dual.dominant.kind, "idle", `Iteration ${i}: count 0 must yield idle dominant`);
      assert.strictEqual(dual.dominant.priorityWeight, 0, `Iteration ${i}: count 0 dominant weight must be 0`);
      assert.strictEqual(dual.satellite, null, `Iteration ${i}: count 0 satellite must be null`);
      assert.strictEqual(dual.unsuppressedCount, 0, `Iteration ${i}: unsuppressedCount must be 0`);
    }

    // Invariant 3.2: 1 unsuppressed state -> dominant is that state, satellite is null
    if (count === 1) {
      assert.strictEqual(dual.dominant.id, sortedUnsuppressed[0].id, `Iteration ${i}: count 1 dominant id mismatch`);
      assert.strictEqual(dual.dominant.kind, sortedUnsuppressed[0].kind, `Iteration ${i}: count 1 dominant kind mismatch`);
      assert.strictEqual(dual.satellite, null, `Iteration ${i}: count 1 satellite must be null`);
      assert.strictEqual(dual.unsuppressedCount, 1, `Iteration ${i}: unsuppressedCount must be 1`);
    }

    // Invariant 3.3: >= 2 unsuppressed states
    if (count >= 2) {
      assert.ok(dual.satellite !== null, `Iteration ${i}: count >= 2 must have non-null satellite`);
      assert.notStrictEqual(dual.dominant.id, dual.satellite.id, `Iteration ${i}: dominant and satellite must have different ids`);
      assert.strictEqual(dual.unsuppressedCount, count, `Iteration ${i}: unsuppressedCount must be ${count}`);

      if (!swapTarget || !sortedUnsuppressed.some((s) => s.kind === swapTarget)) {
        // Without active swap: dominant is highest priority, satellite is 2nd highest
        assert.strictEqual(
          dual.dominant.id,
          sortedUnsuppressed[0].id,
          `Iteration ${i}: unswapped dominant must be highest priority (sorted[0])`
        );
        assert.strictEqual(
          dual.satellite.id,
          sortedUnsuppressed[1].id,
          `Iteration ${i}: unswapped satellite must be 2nd highest priority (sorted[1])`
        );
        assert.ok(
          dual.dominant.priorityWeight >= dual.satellite.priorityWeight,
          `Iteration ${i}: dominant weight (${dual.dominant.priorityWeight}) must be >= satellite weight (${dual.satellite.priorityWeight})`
        );
      } else {
        // With active swap: dominant is the swapped state
        assert.strictEqual(dual.dominant.kind, swapTarget, `Iteration ${i}: swapped dominant kind mismatch`);
        // Satellite is top state if target was not 0, or 2nd state if target was 0
        const targetIdx = sortedUnsuppressed.findIndex((s) => s.kind === swapTarget);
        const expectedSatellite = targetIdx === 0 ? sortedUnsuppressed[1] : sortedUnsuppressed[0];
        assert.strictEqual(dual.satellite.id, expectedSatellite.id, `Iteration ${i}: swapped satellite mismatch`);
      }
    }

    // INVARIANT 4: Idempotence & Pool Invariant Consistency
    const rerun = resolveDualTaskStates(rawStates, route, swapTarget);
    assert.deepStrictEqual(dual, rerun, `Iteration ${i}: resolveDualTaskStates is not purely idempotent`);

    // State pool check
    const pool = computeDynamicIslandStatePool({
      activeSession,
      offlineSession,
      syncState,
      recovery: recActive ? { active: true, stage, targetMinutes: targetMin } : null,
      eveningReview: eveningDue ? { due: true, minimumActionDone: false, dailyReviewDone: false } : null,
      pendingConfirmationsCount: pendingConf as number | undefined,
      elapsedSeconds: elapsed,
      pathname: route,
    });
    assert.strictEqual(validateStatePoolInvariants(pool), true, `Iteration ${i}: validateStatePoolInvariants failed`);
  }

  const durationMs = performance.now() - startTime;
  assert.ok(durationMs < 2500, `10,000 iterations completed in ${durationMs.toFixed(2)}ms (expected < 2500ms)`);
});

// ============================================================================
// CHALLENGE SUITE 2: Dynamic Aura Theme & Default Tab Invariant Matrix
// ============================================================================

test("M1 Challenger Stress: Dynamic Aura Theme mapping exhaustiveness and integrity", () => {
  const allKinds: DynamicIslandCapsuleKind[] = [
    "evening_review_due",
    "recovery_active",
    "sync_issue",
    "confirmations_pending",
    "live_session_running",
    "live_session_closing",
    "activity_paused",
    "idle",
  ];

  const expectedThemes: Record<DynamicIslandCapsuleKind, string> = {
    evening_review_due: "indigo",
    recovery_active: "amber",
    sync_issue: "amber",
    confirmations_pending: "amber",
    live_session_running: "teal",
    live_session_closing: "teal",
    activity_paused: "teal",
    idle: "silver",
  };

  const expectedTabs: Record<DynamicIslandCapsuleKind, string> = {
    evening_review_due: "evening",
    recovery_active: "status",
    sync_issue: "status",
    confirmations_pending: "status",
    live_session_running: "stopwatch",
    live_session_closing: "stopwatch",
    activity_paused: "stopwatch",
    idle: "search",
  };

  for (const kind of allKinds) {
    const theme = getAuraThemeForStateKind(kind);
    assert.strictEqual(theme, expectedThemes[kind], `Theme mismatch for kind ${kind}`);

    const tab = getDefaultTabForStateKind(kind);
    assert.strictEqual(tab, expectedTabs[kind], `Default tab mismatch for kind ${kind}`);

    const styles = getAuraStyles(kind);
    assert.strictEqual(styles.theme, expectedThemes[kind], `Aura style theme mismatch for kind ${kind}`);
    assert.strictEqual(styles.defaultTab, expectedTabs[kind], `Aura style default tab mismatch for kind ${kind}`);
    assert.ok(styles.primaryColor.startsWith("#"), `primaryColor must be hex for ${kind}`);
    assert.ok(styles.primaryRgba.startsWith("rgba("), `primaryRgba must be rgba for ${kind}`);
    assert.ok(styles.borderClass.length > 0, `borderClass must be non-empty for ${kind}`);
    assert.ok(styles.hubBorderClass.length > 0, `hubBorderClass must be non-empty for ${kind}`);
    assert.ok(styles.hubShadowClass.length > 0, `hubShadowClass must be non-empty for ${kind}`);

    const expandedClass = getExpandedHubAuraClass(kind);
    assert.ok(expandedClass.includes(styles.hubBorderClass), `expanded class must include hubBorderClass for ${kind}`);

    const satelliteClass = getSatelliteBubbleGlowClass(kind);
    assert.strictEqual(satelliteClass, styles.satelliteGlowClass, `satellite bubble class mismatch for ${kind}`);
  }

  // Fallback testing for unknown / null / undefined kinds
  assert.strictEqual(getAuraThemeForStateKind(null), "silver");
  assert.strictEqual(getAuraThemeForStateKind(undefined), "silver");
  assert.strictEqual(getAuraThemeForStateKind("non_existent_kind" as DynamicIslandCapsuleKind), "silver");
  assert.strictEqual(getDefaultTabForStateKind(null), "search");
  assert.strictEqual(getDefaultTabForStateKind(undefined), "search");
  assert.strictEqual(getDefaultTabForStateKind("non_existent_kind" as DynamicIslandCapsuleKind), "search");
});

// ============================================================================
// CHALLENGE SUITE 3: Micro-Operation & Boundary Stress
// ============================================================================

test("M1 Challenger Stress: Fluid swap edge-case matrix across varying concurrency counts", () => {
  const session = createMockSession("running");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 1, targetMinutes: 30 };
  const eveningReview: DynamicIslandEveningReviewProps = { due: true, minimumActionDone: true, dailyReviewDone: false };
  const syncState: DynamicIslandSyncState = "blocked";

  const raw4States = collectDynamicIslandActiveStates({
    activeSession: session,
    recovery,
    eveningReview,
    syncState,
  });

  assert.strictEqual(raw4States.length, 4);

  // Swap to 4th priority state (sync_issue, P5=500)
  const swap4 = resolveDualTaskStates(raw4States, "/dashboard", "sync_issue");
  assert.strictEqual(swap4.dominant.kind, "sync_issue");
  assert.strictEqual(swap4.satellite?.kind, "live_session_running", "Top priority becomes satellite");

  // Swap to 3rd priority state (evening_review_due, P4=600)
  const swap3 = resolveDualTaskStates(raw4States, "/dashboard", "evening_review_due");
  assert.strictEqual(swap3.dominant.kind, "evening_review_due");
  assert.strictEqual(swap3.satellite?.kind, "live_session_running", "Top priority becomes satellite");

  // Swap to 1st priority state (already dominant) -> satellite stays 2nd priority (recovery_active)
  const swap1 = resolveDualTaskStates(raw4States, "/dashboard", "live_session_running");
  assert.strictEqual(swap1.dominant.kind, "live_session_running");
  assert.strictEqual(swap1.satellite?.kind, "recovery_active");

  // Swap on route where requested state is suppressed -> falls back to natural unsuppressed ordering
  const swapSuppressed = resolveDualTaskStates(raw4States, "/focus", "live_session_running");
  // live_session_running is suppressed on /focus -> unsuppressed: recovery (P3), evening (P4), sync (P5)
  assert.strictEqual(swapSuppressed.dominant.kind, "recovery_active");
  assert.strictEqual(swapSuppressed.satellite?.kind, "evening_review_due");
});

test("M1 Challenger Stress: High-Throughput Performance (50,000 dual-task calls under 1000ms)", () => {
  const session = createMockSession("running");
  const input: CollectDynamicIslandStatesInput = {
    activeSession: session,
    recovery: { active: true, stage: 2, targetMinutes: 60 },
    eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
    syncState: "deferred",
    pendingConfirmationsCount: 3,
    elapsedSeconds: 1500,
  };

  const rawStates = collectDynamicIslandActiveStates(input);
  const start = performance.now();

  const ITERATIONS = 50000;
  for (let i = 0; i < ITERATIONS; i++) {
    const route = i % 2 === 0 ? "/focus" : "/dashboard";
    const res = resolveDualTaskStates(rawStates, route);
    if (!res.dominant) throw new Error("Dominant missing");
  }

  const elapsedMs = performance.now() - start;
  assert.ok(
    elapsedMs < 1000,
    `50,000 dual-task resolutions completed in ${elapsedMs.toFixed(2)}ms (expected < 1000ms)`
  );
});
