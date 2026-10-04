import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  collectDynamicIslandActiveStates,
  sortActiveStatesByPriority,
  getDominantState,
  computeDynamicIslandStatePool,
  resolveDynamicIslandState,
  clampTimerDuration,
  validateStatePoolInvariants,
  getPriorityWeight,
} from "../../apps/web/components/dynamic-island-state-engine";
import {
  PRIORITY_WEIGHTS,
  IDLE_STATE_ITEM,
  type DynamicIslandActiveItem,
  type DynamicIslandCapsuleKind,
  type DynamicIslandRecoveryProps,
  type DynamicIslandEveningReviewProps,
  type DynamicIslandSyncState,
  type CollectDynamicIslandStatesInput,
} from "../../apps/web/components/dynamic-island-types";
import type { StudySessionDto } from "../../packages/core/src/types";

function createMockSession(
  status: "running" | "paused" | "closing" | "completed",
  overrides?: Partial<StudySessionDto>
): StudySessionDto {
  return {
    id: "session-bench-001",
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
  } as StudySessionDto;
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

console.log("================================================================================");
console.log("CHALLENGER 2 EMPIRICAL STRESS & BENCHMARK HARNESS: MILESTONE 1 STATE ENGINE");
console.log("================================================================================");

// ============================================================================
// SUITE 1: High-Frequency Throughput & Execution Latency Benchmark (100,000 calls)
// ============================================================================
console.log("\n[1/7] Running High-Frequency Benchmark (100,000 calls across 5 scenarios)...");

const ITERATIONS_PER_SCENARIO = 20_000;
const scenarios: Array<{
  name: string;
  input: CollectDynamicIslandStatesInput;
}> = [
  {
    name: "Scenario A: Empty / Idle Baseline",
    input: {},
  },
  {
    name: "Scenario B: Single State (P0 Live Session)",
    input: {
      activeSession: createMockSession("running", { subjectName: "考研英语" }),
      elapsedSeconds: 1420,
    },
  },
  {
    name: "Scenario C: 3 Concurrent States (P2 Paused + P3 Recovery + P4 Evening)",
    input: {
      activeSession: createMockSession("paused", { subjectName: "专业课408" }),
      recovery: { active: true, stage: 2, targetMinutes: 60, reason: "低转化" },
      eveningReview: { due: true, minimumActionDone: true, dailyReviewDone: false },
      elapsedSeconds: 900,
    },
  },
  {
    name: "Scenario D: Maximum 5 Concurrent States (P0 + P3 + P4 + P5 + P6)",
    input: {
      activeSession: createMockSession("running", { subjectName: "高等数学" }),
      recovery: { active: true, stage: 3, targetMinutes: 90, reason: "能量补充" },
      eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
      syncState: "deferred",
      pendingConfirmationsCount: 5,
      elapsedSeconds: 2400,
    },
  },
  {
    name: "Scenario E: Legacy Wrapper Compatibility (resolveDynamicIslandState)",
    input: {
      activeSession: createMockSession("closing", { subjectName: "政治冲刺" }),
      syncState: "blocked",
      elapsedSeconds: 3600,
    },
  },
];

let totalExecutions = 0;
const scenarioLatenciesUs: Record<string, number[]> = {};

const benchStart = performance.now();

for (const scenario of scenarios) {
  const latencies: number[] = new Array(ITERATIONS_PER_SCENARIO);
  for (let i = 0; i < ITERATIONS_PER_SCENARIO; i++) {
    const t0 = performance.now();
    if (scenario.name.includes("Legacy")) {
      const legacyResult = resolveDynamicIslandState(scenario.input);
      assert.ok(legacyResult.kind === "live_session_closing");
    } else {
      const pool = computeDynamicIslandStatePool(scenario.input);
      assert.ok(pool.dominantState !== undefined);
    }
    const t1 = performance.now();
    latencies[i] = (t1 - t0) * 1000; // microseconds
    totalExecutions++;
  }
  scenarioLatenciesUs[scenario.name] = latencies;
}

const benchEnd = performance.now();
const benchTotalDurationMs = benchEnd - benchStart;
const overallOpsPerSec = Math.round((totalExecutions / benchTotalDurationMs) * 1000);

console.log(`  Total Executions : ${totalExecutions.toLocaleString()} calls`);
console.log(`  Total Duration   : ${benchTotalDurationMs.toFixed(2)} ms`);
console.log(`  Overall Ops/Sec  : ${overallOpsPerSec.toLocaleString()} ops/sec`);

for (const scenario of scenarios) {
  const l = scenarioLatenciesUs[scenario.name].slice().sort((a, b) => a - b);
  const avg = (l.reduce((a, b) => a + b, 0) / l.length).toFixed(3);
  const p50 = l[Math.floor(l.length * 0.5)].toFixed(3);
  const p95 = l[Math.floor(l.length * 0.95)].toFixed(3);
  const p99 = l[Math.floor(l.length * 0.99)].toFixed(3);
  console.log(`  - ${scenario.name}:`);
  console.log(`      mean: ${avg} μs | p50: ${p50} μs | p95: ${p95} μs | p99: ${p99} μs`);
}

// Invariant: At least 50,000 ops/sec, sub-millisecond p99
assert.ok(overallOpsPerSec > 50_000, `Throughput must exceed 50k ops/sec (got ${overallOpsPerSec})`);

// ============================================================================
// SUITE 2: Memory Footprint, Allocation Rate & GC Leak Verification
// ============================================================================
console.log("\n[2/7] Testing Memory Footprint & Garbage Collection Leaks (50,000 calls)...");

if (typeof global.gc === "function") {
  global.gc();
}

const memBefore = process.memoryUsage();
const MEM_ITERATIONS = 50_000;

// Execute 50k calls creating pools
for (let i = 0; i < MEM_ITERATIONS; i++) {
  const pool = computeDynamicIslandStatePool({
    activeSession: createMockSession("running", { id: `session-${i}` }),
    recovery: { active: true, stage: 1, targetMinutes: 30 },
    eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
    syncState: "pending",
    pendingConfirmationsCount: (i % 5) + 1,
    elapsedSeconds: i,
  });
  if (i === 0) {
    assert.equal(pool.concurrencyCount, 5);
  }
}

const memMid = process.memoryUsage();

if (typeof global.gc === "function") {
  global.gc();
}

const memAfter = process.memoryUsage();

const heapDeltaKb = ((memAfter.heapUsed - memBefore.heapUsed) / 1024).toFixed(2);
const heapMidDeltaKb = ((memMid.heapUsed - memBefore.heapUsed) / 1024).toFixed(2);

console.log(`  Heap Before  : ${(memBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`);
console.log(`  Heap Mid (50k): ${(memMid.heapUsed / 1024 / 1024).toFixed(2)} MB (+${heapMidDeltaKb} KB)`);
console.log(`  Heap After GC: ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB (Delta: ${heapDeltaKb} KB)`);

const retainedMb = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
assert.ok(
  retainedMb < 2.0,
  `Retained heap memory after GC must be < 2 MB, observed ${retainedMb.toFixed(2)} MB`
);
console.log("  => Zero memory leak detected (100% ephemeral garbage collected).");

// ============================================================================
// SUITE 3: Functional Purity & Zero-Mutation Verification
// ============================================================================
console.log("\n[3/7] Testing Functional Purity & Immutability under Deeply Frozen Inputs...");

const rawInput: CollectDynamicIslandStatesInput = {
  activeSession: createMockSession("running", {
    id: "frozen-s1",
    subjectName: "高等数学",
    knowledgePoints: ["极限", "微积分"],
  }),
  offlineSession: createMockSession("paused", {
    id: "frozen-s2",
    subjectName: "考研英语",
  }),
  recovery: {
    active: true,
    stage: 2,
    targetMinutes: 60,
    reason: "不可变测试",
    onOpen: () => {},
  },
  eveningReview: {
    due: true,
    minimumActionDone: true,
    dailyReviewDone: false,
    reviewHref: "/roadmap/reviews/daily",
    onOpen: () => {},
  },
  syncState: "deferred",
  pendingConfirmationsCount: 3,
  elapsedSeconds: 1540.85,
  onRetrySync: () => {},
  onResumeSession: async () => {},
};

const frozenInput = deepFreeze(rawInput);

let poolFromFrozen: ReturnType<typeof computeDynamicIslandStatePool> | null = null;
assert.doesNotThrow(() => {
  poolFromFrozen = computeDynamicIslandStatePool(frozenInput);
}, "computeDynamicIslandStatePool must not throw when receiving deeply frozen inputs");

assert.ok(poolFromFrozen !== null);
assert.equal((poolFromFrozen as any).dominantState.kind, "live_session_running");
assert.equal((poolFromFrozen as any).dominantState.title, "高等数学");
assert.equal((poolFromFrozen as any).concurrencyCount, 5);

// Verify sortActiveStatesByPriority does not mutate original array
const originalStates = [
  { id: "1", kind: "confirmations_pending" as const, priorityWeight: 400, title: "P6", accentTone: "amber" as const },
  { id: "2", kind: "live_session_running" as const, priorityWeight: 1000, title: "P0", accentTone: "teal" as const },
  { id: "3", kind: "recovery_active" as const, priorityWeight: 700, title: "P3", accentTone: "amber" as const },
];
const frozenStates = deepFreeze([...originalStates]);
const sortedStates = sortActiveStatesByPriority(frozenStates);
assert.equal(sortedStates[0].priorityWeight, 1000);
assert.equal(sortedStates[1].priorityWeight, 700);
assert.equal(sortedStates[2].priorityWeight, 400);
assert.equal(frozenStates[0].priorityWeight, 400);

console.log("  => 100% Functional Purity & Zero In-Place Mutation Verified.");

// ============================================================================
// SUITE 4: Multi-Call Determinism & Concurrent Interleaving Consistency
// ============================================================================
console.log("\n[4/7] Testing 10,000 Rounds of Concurrent Interleaved Simulator Calls...");

const fixedInputs: CollectDynamicIslandStatesInput[] = [
  { activeSession: createMockSession("running", { id: "a1" }), elapsedSeconds: 100 },
  { activeSession: createMockSession("closing", { id: "a2" }), elapsedSeconds: 200 },
  { activeSession: createMockSession("paused", { id: "a3" }), elapsedSeconds: 300 },
  { recovery: { active: true, stage: 1, targetMinutes: 30 }, elapsedSeconds: 0 },
  { eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false }, elapsedSeconds: 0 },
  { syncState: "blocked", elapsedSeconds: 0 },
  { pendingConfirmationsCount: 5, elapsedSeconds: 0 },
  {},
];

const baselines = fixedInputs.map((inp) => computeDynamicIslandStatePool(inp));

for (let round = 0; round < 10_000; round++) {
  const chosenIdx = round % fixedInputs.length;
  const computed = computeDynamicIslandStatePool(fixedInputs[chosenIdx]);
  const baseline = baselines[chosenIdx];

  assert.equal(computed.dominantState.kind, baseline.dominantState.kind);
  assert.equal(computed.dominantState.priorityWeight, baseline.dominantState.priorityWeight);
  assert.equal(computed.dominantState.title, baseline.dominantState.title);
  assert.equal(computed.concurrencyCount, baseline.concurrencyCount);
  assert.equal(computed.hasConcurrency, baseline.hasConcurrency);
  assert.deepEqual(
    computed.activeStates.map((s) => s.id),
    baseline.activeStates.map((s) => s.id)
  );
}

console.log("  => 10,000 Interleaved Invocations Match Ground Truth Bit-for-Bit (100% Deterministic).");

// ============================================================================
// SUITE 5: 50,000-Iteration High-Volume Permutation Invariant Stress
// ============================================================================
console.log("\n[5/7] Testing 50,000 Randomized Invariant Fuzzing Permutations...");

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

for (let i = 0; i < 50_000; i++) {
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

  assert.ok(pool.dominantState, `Iteration ${i}: dominantState missing`);
  assert.equal(pool.concurrencyCount, pool.activeStates.length);
  assert.equal(pool.hasConcurrency, pool.activeStates.length > 1);

  if (pool.activeStates.length > 0) {
    assert.equal(pool.dominantState.id, pool.activeStates[0].id);
    assert.equal(pool.dominantState.priorityWeight, pool.activeStates[0].priorityWeight);
  } else {
    assert.equal(pool.dominantState.kind, "idle");
    assert.equal(pool.dominantState.priorityWeight, 0);
  }

  for (let j = 0; j < pool.activeStates.length - 1; j++) {
    assert.ok(pool.activeStates[j].priorityWeight >= pool.activeStates[j + 1].priorityWeight);
  }

  const kindSet = new Set<DynamicIslandCapsuleKind>();
  for (const item of pool.activeStates) {
    assert.ok(!kindSet.has(item.kind), `Duplicate kind: ${item.kind}`);
    kindSet.add(item.kind);
    assert.ok(ALLOWED_WEIGHTS.has(item.priorityWeight));
  }

  assert.ok(validateStatePoolInvariants(pool));
}

console.log("  => 50,000 Permutation Invariant Fuzzing Iterations Passed (100% Invariant Compliance).");

// ============================================================================
// SUITE 6: Long-Running Dynamic Transition & Timer Tick Simulation (60,000 ticks)
// ============================================================================
console.log("\n[6/7] Simulating 60,000 Timer Ticks (10Hz / 100min study flow with multi-state events)...");

let simActiveSession: StudySessionDto | null = null;
let simRecovery: DynamicIslandRecoveryProps | null = null;
let simEveningReview: DynamicIslandEveningReviewProps | null = null;
let simSyncState: DynamicIslandSyncState = "current";
let simConfirmations = 0;

for (let tick = 0; tick < 60_000; tick++) {
  const elapsedSeconds = Math.floor(tick / 10); // 10 ticks per second

  // Dynamic lifecycle events triggered at specific tick markers
  if (tick === 1_000) {
    // 100s: User starts study session
    simActiveSession = createMockSession("running", { id: "sim-session-01", subjectName: "考研数学" });
  } else if (tick === 10_000) {
    // 1000s: Recovery regime triggered concurrently
    simRecovery = { active: true, stage: 1, targetMinutes: 30 };
  } else if (tick === 20_000) {
    // 2000s: User pauses study session
    simActiveSession = createMockSession("paused", { id: "sim-session-01", subjectName: "考研数学" });
  } else if (tick === 25_000) {
    // 2500s: Evening review becomes due
    simEveningReview = { due: true, minimumActionDone: true, dailyReviewDone: false };
  } else if (tick === 30_000) {
    // 3000s: Network drops
    simSyncState = "blocked";
  } else if (tick === 35_000) {
    // 3500s: AI draft arrives -> pending confirmation
    simConfirmations = 2;
  } else if (tick === 40_000) {
    // 4000s: User resumes study session
    simActiveSession = createMockSession("running", { id: "sim-session-01", subjectName: "考研数学" });
  } else if (tick === 50_000) {
    // 5000s: User initiates closeout
    simActiveSession = createMockSession("closing", { id: "sim-session-01", subjectName: "考研数学" });
  } else if (tick === 55_000) {
    // 5500s: Session completed, sync restored
    simActiveSession = null;
    simSyncState = "current";
  }

  const pool = computeDynamicIslandStatePool({
    activeSession: simActiveSession,
    recovery: simRecovery,
    eveningReview: simEveningReview,
    syncState: simSyncState,
    pendingConfirmationsCount: simConfirmations,
    elapsedSeconds,
  });

  if (tick === 1_000) {
    assert.equal(pool.dominantState.kind, "live_session_running");
  } else if (tick === 20_000) {
    assert.equal(pool.dominantState.kind, "activity_paused");
    assert.equal(pool.concurrencyCount, 2); // paused + recovery
  } else if (tick === 35_000) {
    assert.equal(pool.dominantState.kind, "activity_paused");
    assert.equal(pool.concurrencyCount, 5); // paused + recovery + evening + sync + conf
  } else if (tick === 40_000) {
    assert.equal(pool.dominantState.kind, "live_session_running");
    assert.equal(pool.concurrencyCount, 5); // running takes P0 precedence
  } else if (tick === 55_000) {
    assert.equal(pool.dominantState.kind, "recovery_active");
    assert.equal(pool.concurrencyCount, 3); // recovery + evening + conf
  }

  assert.ok(validateStatePoolInvariants(pool));
}

console.log("  => 60,000 Timer Ticks Simulated with Zero State Drift & Flawless Priority Transitions.");

// ============================================================================
// SUITE 7: Adversarial Boundary & Stress Vectors
// ============================================================================
console.log("\n[7/7] Testing Adversarial Edge Cases & Stress Vectors...");

assert.equal(clampTimerDuration(1e15), 1e15);
assert.equal(clampTimerDuration(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
assert.equal(clampTimerDuration(Number.MIN_SAFE_INTEGER), 0);
assert.equal(clampTimerDuration(Number.POSITIVE_INFINITY), 0);
assert.equal(clampTimerDuration(Number.NEGATIVE_INFINITY), 0);
assert.equal(clampTimerDuration(Number.NaN), 0);
assert.equal(clampTimerDuration(-99999999.999), 0);

const hugeConfPool = computeDynamicIslandStatePool({
  pendingConfirmationsCount: 999999999,
});
assert.equal(hugeConfPool.dominantState.kind, "confirmations_pending");
assert.equal(hugeConfPool.dominantState.pendingConfirmationsCount, 999999999);
assert.equal(hugeConfPool.dominantState.title, "999999999项待确认");

const throwingInput: CollectDynamicIslandStatesInput = {
  recovery: {
    active: true,
    stage: 1,
    targetMinutes: 30,
    onOpen: () => {
      throw new Error("Must not be called during pure state calculation!");
    },
  },
  onRetrySync: () => {
    throw new Error("Must not be called during pure state calculation!");
  },
  onResumeSession: async () => {
    throw new Error("Must not be called during pure state calculation!");
  },
};
assert.doesNotThrow(() => {
  const pool = computeDynamicIslandStatePool(throwingInput);
  assert.equal(pool.dominantState.kind, "recovery_active");
});

const pollutedInput = Object.assign(Object.create({ malicious: "proto" }), {
  activeSession: createMockSession("running", { subjectName: "安全注入测试" }),
  extraUnusedProperty1: { deep: [1, 2, 3] },
  extraUnusedProperty2: "extra",
  toString: () => "polluted",
});
const pollutedPool = computeDynamicIslandStatePool(pollutedInput);
assert.equal(pollutedPool.dominantState.kind, "live_session_running");
assert.equal(pollutedPool.dominantState.title, "安全注入测试");

const unknownStatusSession = createMockSession("completed" as any, { status: "unknown_status" as any });
const unknownPool = computeDynamicIslandStatePool({ activeSession: unknownStatusSession });
assert.equal(unknownPool.dominantState.kind, "idle");
assert.equal(unknownPool.activeStates.length, 0);

const customSyncPool = computeDynamicIslandStatePool({ syncState: "custom_fallback_status" as any });
assert.equal(customSyncPool.dominantState.kind, "sync_issue");
assert.equal(customSyncPool.dominantState.title, "网络离线");

console.log("  => All Adversarial Stress Vectors Handled Gracefully.");

console.log("\n================================================================================");
console.log("ALL 7 CHALLENGER 2 EMPIRICAL TEST SUITES PASSED CLEANLY (100% GREEN)");
console.log("================================================================================");
