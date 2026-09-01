import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import {
  SatelliteBubble,
  CapsuleRightSegment,
  CapsuleLeftSegment,
} from "./dynamic-island-segments";
import {
  computeDynamicIslandStatePool,
  resolveDualTaskStates,
  sortActiveStatesByPriority,
  getDominantState,
  validateStatePoolInvariants,
  type DynamicIslandCapsuleKind,
  type DynamicIslandActiveItem,
  type DynamicIslandStateKind,
  type DualTaskResolutionResult,
  PRIORITY_WEIGHTS,
} from "./dynamic-island";
import {
  filterStatesByRouteContext,
  isStateSuppressedOnRoute,
} from "./dynamic-island-state-engine";
import {
  getSatelliteBubbleGlowClass,
  getCapsuleGlowStyle,
  getExpandedHubAuraClass,
} from "./dynamic-island-glow";
import type { StudySessionDto } from "@/lib/contracts";

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

function createMockSession(
  status: "running" | "paused" | "closing" | "completed",
  overrides?: Partial<StudySessionDto>
): StudySessionDto {
  return {
    id: `session-stress-${status}`,
    subjectId: "subj-stress-01",
    subjectName: overrides?.subjectName || "高等数学",
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

function buildMockStatePool(activeKinds: DynamicIslandCapsuleKind[]): DynamicIslandActiveItem[] {
  const items: DynamicIslandActiveItem[] = [];

  for (const kind of activeKinds) {
    const weight = PRIORITY_WEIGHTS[kind];
    switch (kind) {
      case "live_session_running":
        items.push({
          id: `item_${kind}`,
          kind,
          priorityWeight: weight,
          title: "高等数学",
          subtitle: "正向心流计时",
          accentTone: "teal",
          session: createMockSession("running"),
          elapsedSeconds: 1200,
        });
        break;
      case "live_session_closing":
        items.push({
          id: `item_${kind}`,
          kind,
          priorityWeight: weight,
          title: "高等数学",
          subtitle: "待收口沉淀",
          accentTone: "emerald",
          session: createMockSession("closing"),
          elapsedSeconds: 1200,
        });
        break;
      case "activity_paused":
        items.push({
          id: `item_${kind}`,
          kind,
          priorityWeight: weight,
          title: "高等数学 暂停中",
          subtitle: "已保存断点",
          accentTone: "amber",
          session: createMockSession("paused"),
          elapsedSeconds: 1200,
        });
        break;
      case "recovery_active":
        items.push({
          id: `item_${kind}`,
          kind,
          priorityWeight: weight,
          title: "⚡ 恢复第2阶",
          subtitle: "需完成30分钟最小行动",
          accentTone: "amber",
          stage: 2,
          targetMinutes: 30,
        });
        break;
      case "evening_review_due":
        items.push({
          id: `item_${kind}`,
          kind,
          priorityWeight: weight,
          title: "🌙 晚间复盘待收口",
          subtitle: "最低行动已达成",
          accentTone: "indigo",
          minimumActionDone: true,
          dailyReviewDone: false,
          reviewHref: "/roadmap/reviews/daily",
        });
        break;
      case "sync_issue":
        items.push({
          id: `item_${kind}`,
          kind,
          priorityWeight: weight,
          title: "离线待对账",
          subtitle: "本地专注记录待同步",
          accentTone: "amber",
          syncState: "deferred",
        });
        break;
      case "confirmations_pending":
        items.push({
          id: `item_${kind}`,
          kind,
          priorityWeight: weight,
          title: "4项待确认",
          subtitle: "周期报告待审核",
          accentTone: "amber",
          pendingConfirmationsCount: 4,
        });
        break;
      case "idle":
        items.push({
          id: "item_idle",
          kind: "idle",
          priorityWeight: 0,
          title: "AreaForge",
          subtitle: "搜索或输入命令… ⌘K",
          accentTone: "zinc",
        });
        break;
    }
  }

  return sortActiveStatesByPriority(items);
}

// ============================================================================
// STRESS SUITE 1: Exclamation Mark Layout under ALL Dual-Task Combinations
// ============================================================================

test("Stress M2: Priority weights strictly satisfy deterministic total order", () => {
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

  for (let i = 0; i < kinds.length - 1; i++) {
    const higher = kinds[i];
    const lower = kinds[i + 1];
    assert.ok(
      PRIORITY_WEIGHTS[higher] > PRIORITY_WEIGHTS[lower],
      `Priority invariant: ${higher} (${PRIORITY_WEIGHTS[higher]}) must be > ${lower} (${PRIORITY_WEIGHTS[lower]})`
    );
  }
});

test("Stress M2: All 21 distinct pairwise state combinations render valid Exclamation Mark layout", () => {
  const nonIdleKinds: DynamicIslandCapsuleKind[] = [
    "live_session_running",
    "live_session_closing",
    "activity_paused",
    "recovery_active",
    "evening_review_due",
    "sync_issue",
    "confirmations_pending",
  ];

  let pairCount = 0;

  for (let i = 0; i < nonIdleKinds.length; i++) {
    for (let j = i + 1; j < nonIdleKinds.length; j++) {
      const kindA = nonIdleKinds[i];
      const kindB = nonIdleKinds[j];
      pairCount++;

      const items = buildMockStatePool([kindA, kindB]);
      const result = resolveDualTaskStates(items);

      // Verify dominant is higher priority, satellite is lower priority
      assert.equal(result.allUnsuppressed.length, 2);
      assert.equal(result.unsuppressedCount, 2);
      assert.equal(result.dominant.kind, kindA, `Dominant for pair (${kindA}, ${kindB}) must be ${kindA}`);
      assert.ok(result.satellite, `Satellite for pair (${kindA}, ${kindB}) must exist`);
      assert.equal(result.satellite.kind, kindB, `Satellite for pair (${kindA}, ${kindB}) must be ${kindB}`);

      // Verify SatelliteBubble renders cleanly
      const bubble = SatelliteBubble({
        satelliteItem: result.satellite,
        onSwapFluidFocus: () => {},
      }) as React.ReactElement<{ className?: string; role?: string; "aria-label"?: string }>;

      assert.ok(bubble, `SatelliteBubble must render for satellite ${kindB}`);
      assert.equal(bubble.props.role, "button");
      const className = bubble.props.className ?? "";
      assert.ok(className.includes("rounded-full"), "Must be circular rounded-full");
      assert.ok(className.includes("backdrop-blur-2xl"), "Must have obsidian glass backdrop blur");
    }
  }

  assert.equal(pairCount, 21, "Must test exactly 21 unique pairwise combinations");
});

test("Stress M2: Boundary state counts (0, 1, 2, ..., 7 states) resolve dual-task invariants", () => {
  const allKinds: DynamicIslandCapsuleKind[] = [
    "live_session_running",
    "live_session_closing",
    "activity_paused",
    "recovery_active",
    "evening_review_due",
    "sync_issue",
    "confirmations_pending",
  ];

  // 0 states -> idle dominant, null satellite
  const zeroResult = resolveDualTaskStates([]);
  assert.equal(zeroResult.dominant.kind, "idle");
  assert.equal(zeroResult.satellite, null);
  assert.equal(zeroResult.unsuppressedCount, 0);

  // 1 state -> single dominant, null satellite
  for (const kind of allKinds) {
    const oneResult = resolveDualTaskStates(buildMockStatePool([kind]));
    assert.equal(oneResult.dominant.kind, kind);
    assert.equal(oneResult.satellite, null);
    assert.equal(oneResult.unsuppressedCount, 1);
  }

  // 3 to 7 states -> dominant is sorted[0], satellite is sorted[1], count is N
  for (let k = 3; k <= allKinds.length; k++) {
    const subset = allKinds.slice(0, k);
    const pool = buildMockStatePool(subset);
    const multiResult = resolveDualTaskStates(pool);
    assert.equal(multiResult.dominant.kind, subset[0]);
    assert.ok(multiResult.satellite);
    assert.equal(multiResult.satellite.kind, subset[1]);
    assert.equal(multiResult.unsuppressedCount, k);
    assert.equal(multiResult.allUnsuppressed.length, k);
  }
});

test("Stress M2: Route-aware suppression across all dual-task combinations", () => {
  // 1. /focus suppresses running, closing, paused
  const focusPool = buildMockStatePool(["live_session_running", "recovery_active", "evening_review_due"]);
  const focusResult = resolveDualTaskStates(focusPool, "/focus");
  assert.equal(focusResult.dominant.kind, "recovery_active", "Running session must be suppressed on /focus");
  assert.equal(focusResult.satellite?.kind, "evening_review_due");
  assert.equal(focusResult.unsuppressedCount, 2);

  // 2. /today suppresses recovery_active
  const todayPool = buildMockStatePool(["recovery_active", "evening_review_due"]);
  const todayResult = resolveDualTaskStates(todayPool, "/today");
  assert.equal(todayResult.dominant.kind, "evening_review_due", "Recovery must be suppressed on /today");
  assert.equal(todayResult.satellite, null, "Only 1 unsuppressed state remains");
  assert.equal(todayResult.unsuppressedCount, 1);

  // 3. /roadmap/reviews suppresses evening_review_due
  const reviewPool = buildMockStatePool(["evening_review_due", "sync_issue"]);
  const reviewResult = resolveDualTaskStates(reviewPool, "/roadmap/reviews/daily");
  assert.equal(reviewResult.dominant.kind, "sync_issue", "Evening review must be suppressed on /roadmap/reviews/*");
  assert.equal(reviewResult.satellite, null);
  assert.equal(reviewResult.unsuppressedCount, 1);

  // 4. Away from specific routes -> all states active
  const awayResult = resolveDualTaskStates(reviewPool, "/dashboard");
  assert.equal(awayResult.dominant.kind, "evening_review_due");
  assert.equal(awayResult.satellite?.kind, "sync_issue");
  assert.equal(awayResult.unsuppressedCount, 2);
});

// ============================================================================
// STRESS SUITE 2: Fluid Focus Swapping on Click and Wheel
// ============================================================================

test("Stress M2: Bidirectional fluid swap between any pair (A, B) preserves state completeness", () => {
  const nonIdleKinds: DynamicIslandCapsuleKind[] = [
    "live_session_running",
    "live_session_closing",
    "activity_paused",
    "recovery_active",
    "evening_review_due",
    "sync_issue",
    "confirmations_pending",
  ];

  for (let i = 0; i < nonIdleKinds.length; i++) {
    for (let j = i + 1; j < nonIdleKinds.length; j++) {
      const kindA = nonIdleKinds[i];
      const kindB = nonIdleKinds[j];
      const pool = buildMockStatePool([kindA, kindB]);

      // Initial: dominant=A, satellite=B
      const initial = resolveDualTaskStates(pool, null, null);
      assert.equal(initial.dominant.kind, kindA);
      assert.equal(initial.satellite?.kind, kindB);

      // Swap to B: dominant=B, satellite=A
      const swapped = resolveDualTaskStates(pool, null, kindB);
      assert.equal(swapped.dominant.kind, kindB);
      assert.equal(swapped.satellite?.kind, kindA);

      // Swap back to A: dominant=A, satellite=B
      const restored = resolveDualTaskStates(pool, null, kindA);
      assert.equal(restored.dominant.kind, kindA);
      assert.equal(restored.satellite?.kind, kindB);
    }
  }
});

test("Stress M2: SatelliteBubble click and wheel event handlers invoke swap callbacks and stop propagation", () => {
  const kinds: DynamicIslandCapsuleKind[] = [
    "live_session_running",
    "recovery_active",
    "evening_review_due",
    "sync_issue",
    "confirmations_pending",
  ];

  for (const kind of kinds) {
    let clickedKind: string | null = null;
    let wheeledKind: string | null = null;
    let clickPropagationStopped = false;
    let wheelPropagationStopped = false;

    const bubble = SatelliteBubble({
      satelliteState: { kind, stage: 2, pendingConfirmationsCount: 5 },
      onSwapFluidFocus: (k) => {
        clickedKind = k;
        wheeledKind = k;
      },
    }) as React.ReactElement<{
      onClick?: (e: { stopPropagation: () => void }) => void;
      onWheel?: (e: { stopPropagation: () => void }) => void;
    }>;

    // Test Click
    bubble.props.onClick?.({
      stopPropagation: () => {
        clickPropagationStopped = true;
      },
    });
    assert.equal(clickPropagationStopped, true);
    assert.equal(clickedKind, kind);

    // Test Wheel
    bubble.props.onWheel?.({
      stopPropagation: () => {
        wheelPropagationStopped = true;
      },
    });
    assert.equal(wheelPropagationStopped, true);
    assert.equal(wheeledKind, kind);
  }
});

test("Stress M2: Swapping to 3rd or 4th item in a multi-state pool selects top alternate as satellite", () => {
  const pool = buildMockStatePool([
    "live_session_running", // P0
    "recovery_active",      // P3
    "evening_review_due",   // P4
    "confirmations_pending",// P6
  ]);

  // Swap to P4 (evening_review_due): dominant becomes evening_review_due, satellite becomes top item (live_session_running)
  const swapToP4 = resolveDualTaskStates(pool, null, "evening_review_due");
  assert.equal(swapToP4.dominant.kind, "evening_review_due");
  assert.equal(swapToP4.satellite?.kind, "live_session_running");

  // Swap to P6 (confirmations_pending): dominant becomes confirmations_pending, satellite becomes top item (live_session_running)
  const swapToP6 = resolveDualTaskStates(pool, null, "confirmations_pending");
  assert.equal(swapToP6.dominant.kind, "confirmations_pending");
  assert.equal(swapToP6.satellite?.kind, "live_session_running");

  // Swap to P0 (live_session_running): dominant becomes live_session_running, satellite becomes 2nd item (recovery_active)
  const swapToP0 = resolveDualTaskStates(pool, null, "live_session_running");
  assert.equal(swapToP0.dominant.kind, "live_session_running");
  assert.equal(swapToP0.satellite?.kind, "recovery_active");
});

// ============================================================================
// STRESS SUITE 3: Rapid Consecutive Focus Swaps & State Consistency
// ============================================================================

test("Stress M2: 10,000 rapid consecutive swaps maintain absolute invariant stability and idempotence", () => {
  const pool = buildMockStatePool(["live_session_running", "recovery_active"]);

  let currentSwappedKind: DynamicIslandCapsuleKind | null = null;
  const startTime = Date.now();

  for (let i = 0; i < 10_000; i++) {
    // Alternate swap
    currentSwappedKind = currentSwappedKind === "recovery_active" ? "live_session_running" : "recovery_active";
    const result = resolveDualTaskStates(pool, null, currentSwappedKind);

    if (currentSwappedKind === "recovery_active") {
      assert.equal(result.dominant.kind, "recovery_active");
      assert.equal(result.satellite?.kind, "live_session_running");
    } else {
      assert.equal(result.dominant.kind, "live_session_running");
      assert.equal(result.satellite?.kind, "recovery_active");
    }

    assert.equal(result.allUnsuppressed.length, 2);
    assert.equal(result.unsuppressedCount, 2);
  }

  const durationMs = Date.now() - startTime;
  assert.ok(durationMs < 200, `10,000 swaps must complete in under 200ms (took ${durationMs}ms)`);
});

test("Stress M2: Random stress hopping across 7 active states maintains structural integrity", () => {
  const allKinds: DynamicIslandCapsuleKind[] = [
    "live_session_running",
    "live_session_closing",
    "activity_paused",
    "recovery_active",
    "evening_review_due",
    "sync_issue",
    "confirmations_pending",
  ];

  const pool = buildMockStatePool(allKinds);

  for (let step = 0; step < 1_000; step++) {
    const randomKind = allKinds[Math.floor(Math.random() * allKinds.length)];
    const result = resolveDualTaskStates(pool, null, randomKind);

    assert.equal(result.dominant.kind, randomKind);
    assert.ok(result.satellite);
    assert.notEqual(result.dominant.kind, result.satellite.kind);
    assert.equal(result.unsuppressedCount, 7);
    assert.equal(result.allUnsuppressed.length, 7);
  }
});

test("Stress M2: Graceful fallback when swapped state finishes or gets route-suppressed", () => {
  // Scenario: User had swapped focus to live_session_running
  // Then the user navigates to /focus, which suppresses live_session_running
  const pool = buildMockStatePool(["live_session_running", "recovery_active", "evening_review_due"]);

  // On /focus with swappedPrimaryKind="live_session_running":
  // live_session_running is filtered out by route context, so swappedPrimaryKind is not in unsuppressed
  // resolveDualTaskStates falls back cleanly to sorted[0] (recovery_active) and sorted[1] (evening_review_due)
  const result = resolveDualTaskStates(pool, "/focus", "live_session_running");

  assert.equal(result.dominant.kind, "recovery_active");
  assert.equal(result.satellite?.kind, "evening_review_due");
  assert.equal(result.unsuppressedCount, 2);

  // Scenario 2: Swapped state completely removed from pool (e.g. session completed)
  const poolWithoutSession = buildMockStatePool(["recovery_active", "evening_review_due"]);
  const resultAfterFinish = resolveDualTaskStates(poolWithoutSession, null, "live_session_running");
  assert.equal(resultAfterFinish.dominant.kind, "recovery_active");
  assert.equal(resultAfterFinish.satellite?.kind, "evening_review_due");
  assert.equal(resultAfterFinish.unsuppressedCount, 2);
});

// ============================================================================
// STRESS SUITE 4: Hover Micro-Actions & Keyboard Shortcut Penetration
// ============================================================================

test("Stress M2: Stopwatch hover micro-actions render with proper event isolation", () => {
  const session = createMockSession("running");
  let pauseCount = 0;
  let closeoutCount = 0;
  let pausePropagationStopped = false;
  let closeoutPropagationStopped = false;

  const element = CapsuleRightSegment({
    capsuleState: { kind: "live_session_running", session, elapsedSeconds: 900 },
    isOpen: false,
    onDirectPause: () => pauseCount++,
    onDirectCloseout: () => closeoutCount++,
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;

  const children = React.Children.toArray(element.props.children);
  const hoverContainer = children[1] as React.ReactElement<{ children?: React.ReactNode[] }>;
  const [pauseBtn, closeoutLink] = React.Children.toArray(hoverContainer.props.children) as [
    React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }>,
    React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }>
  ];

  pauseBtn.props.onClick?.({ stopPropagation: () => { pausePropagationStopped = true; } });
  closeoutLink.props.onClick?.({ stopPropagation: () => { closeoutPropagationStopped = true; } });

  assert.equal(pauseCount, 1);
  assert.equal(closeoutCount, 1);
  assert.equal(pausePropagationStopped, true);
  assert.equal(closeoutPropagationStopped, true);
});

test("Stress M2: isInputElement and keyboard shortcuts penetration contract", () => {
  const source = loadSource("components/dynamic-island.tsx");

  // Keybindings
  assert.match(source, /metaKey\s*\|\|\s*e\.ctrlKey/);
  assert.match(source, /key\.toLowerCase\(\)\s*===\s*["']k["']/);
  assert.match(source, /e\.key\s*===\s*["']\/["']/);
  assert.match(source, /e\.key\s*===\s*["']Escape["']/);

  // Input element exclusion
  assert.match(source, /isInputElement/);
  assert.match(source, /tagName === ["']INPUT["']/);
  assert.match(source, /tagName === ["']TEXTAREA["']/);
  assert.match(source, /tagName === ["']SELECT["']/);
  assert.match(source, /isContentEditable/);
});
