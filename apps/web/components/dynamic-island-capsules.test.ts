import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { 
  resolveDynamicIslandState, 
  type DynamicIslandCapsuleKind,
  type DynamicIslandRecoveryProps,
  type DynamicIslandEveningReviewProps,
  type DynamicIslandSyncState
} from "./dynamic-island";
import { getCapsuleGlowStyle } from "./dynamic-island-drawer";
import { formatClockDuration } from "@/lib/formatters";
import { getTimerElapsedSeconds } from "@areaforge/core";
import type { StudySessionDto } from "@/lib/contracts";

function createMockSession(
  status: "running" | "paused" | "closing" | "completed", 
  overrides?: Partial<StudySessionDto>
): StudySessionDto {
  return {
    id: "session-test-01",
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

function loadSource(relativePath: string): string {
  const filePath = path.resolve(__dirname, "..", relativePath);
  return fs.readFileSync(filePath, "utf-8");
}

// ============================================================================
// SUITE 1: Priority Resolution & Collision Matrix
// ============================================================================

test("Priority Resolver: P0 Live Session Running overrides all lower states simultaneously", () => {
  const runningSession = createMockSession("running");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 2, targetMinutes: 60 };
  const eveningReview: DynamicIslandEveningReviewProps = { due: true, minimumActionDone: false, dailyReviewDone: false };

  const state = resolveDynamicIslandState({
    activeSession: runningSession,
    offlineSession: createMockSession("paused", { id: "offline-01" }),
    syncState: "deferred",
    recovery,
    eveningReview,
    elapsedSeconds: 1500,
  });

  assert.equal(state.kind, "live_session_running");
  assert.equal(state.session?.id, "session-test-01");
  assert.equal(state.elapsedSeconds, 1500);
});

test("Priority Resolver: P1 Live Session Closing overrides paused, recovery, evening review, and sync", () => {
  const closingSession = createMockSession("closing");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 1, targetMinutes: 30 };
  const eveningReview: DynamicIslandEveningReviewProps = { due: true, minimumActionDone: false, dailyReviewDone: false };

  const state = resolveDynamicIslandState({
    activeSession: closingSession,
    offlineSession: createMockSession("paused"),
    syncState: "pending",
    recovery,
    eveningReview,
    elapsedSeconds: 2700,
  });

  assert.equal(state.kind, "live_session_closing");
  assert.equal(state.session?.status, "closing");
  assert.equal(state.elapsedSeconds, 2700);
});

test("Priority Resolver: P2 Activity Paused overrides recovery, evening review, and sync issue", () => {
  const pausedSession = createMockSession("paused");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 3, targetMinutes: 90 };
  const eveningReview: DynamicIslandEveningReviewProps = { due: true, minimumActionDone: false, dailyReviewDone: false };

  const state = resolveDynamicIslandState({
    activeSession: pausedSession,
    offlineSession: null,
    syncState: "deferred",
    recovery,
    eveningReview,
    elapsedSeconds: 1200,
  });

  assert.equal(state.kind, "activity_paused");
  assert.equal(state.session?.status, "paused");
  assert.equal(state.elapsedSeconds, 1200);
});

test("Priority Resolver: P3 Recovery Active overrides evening review and sync issue when no active session", () => {
  const recovery: DynamicIslandRecoveryProps = { 
    active: true, 
    stage: 2, 
    targetMinutes: 60,
    reason: "连续低转化"
  };
  const eveningReview: DynamicIslandEveningReviewProps = { due: true, minimumActionDone: false, dailyReviewDone: false };

  const state = resolveDynamicIslandState({
    activeSession: null,
    offlineSession: null,
    syncState: "deferred",
    recovery,
    eveningReview,
    elapsedSeconds: 0,
  });

  assert.equal(state.kind, "recovery_active");
  assert.equal(state.stage, 2);
  assert.equal(state.targetMinutes, 60);
  assert.equal(state.reason, "连续低转化");
});

test("Priority Resolver: P3 Recovery Active falls back to stage 1 and 30m when props are zero or omitted", () => {
  const state = resolveDynamicIslandState({
    activeSession: null,
    offlineSession: null,
    syncState: undefined,
    recovery: { active: true, stage: 0, targetMinutes: 0 },
    eveningReview: null,
    elapsedSeconds: 0,
  });

  assert.equal(state.kind, "recovery_active");
  assert.equal(state.stage, 1);
  assert.equal(state.targetMinutes, 30);
});

test("Priority Resolver: P4 Evening Review Due triggers when due and no higher session or recovery active", () => {
  const eveningReview: DynamicIslandEveningReviewProps = { 
    due: true, 
    minimumActionDone: true, 
    dailyReviewDone: false,
    reviewHref: "/roadmap/reviews/daily"
  };

  const state = resolveDynamicIslandState({
    activeSession: null,
    offlineSession: null,
    syncState: "deferred",
    recovery: { active: false, stage: 1, targetMinutes: 30 },
    eveningReview,
    elapsedSeconds: 0,
  });

  assert.equal(state.kind, "evening_review_due");
  assert.equal(state.minimumActionDone, true);
  assert.equal(state.dailyReviewDone, false);
  assert.equal(state.reviewHref, "/roadmap/reviews/daily");
});

test("Priority Resolver: P4 Evening Review Due defaults reviewHref when omitted", () => {
  const state = resolveDynamicIslandState({
    activeSession: null,
    offlineSession: null,
    syncState: "current",
    recovery: null,
    eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
    elapsedSeconds: 0,
  });

  assert.equal(state.kind, "evening_review_due");
  assert.equal(state.reviewHref, "/roadmap/reviews/daily");
});

test("Priority Resolver: P5 Sync Issue triggers for non-current sync states", () => {
  const nonCurrentSyncStates: DynamicIslandSyncState[] = ["deferred", "pending", "offline", "blocked", "unavailable"];
  for (const syncState of nonCurrentSyncStates) {
    const state = resolveDynamicIslandState({
      activeSession: null,
      offlineSession: null,
      syncState,
      recovery: null,
      eveningReview: null,
      elapsedSeconds: 0,
    });
    assert.equal(state.kind, "sync_issue", `syncState ${syncState} must resolve to sync_issue`);
    assert.equal(state.syncState, syncState);
  }
});

test("Priority Resolver: P6 Idle state returns when syncState is 'current' or all inputs empty", () => {
  const stateCurrent = resolveDynamicIslandState({
    activeSession: null,
    offlineSession: null,
    syncState: "current",
    recovery: null,
    eveningReview: null,
    elapsedSeconds: 0,
  });
  assert.equal(stateCurrent.kind, "idle");

  const stateEmpty = resolveDynamicIslandState({
    activeSession: null,
    offlineSession: null,
    elapsedSeconds: 0,
  });
  assert.equal(stateEmpty.kind, "idle");
});

test("Priority Resolver: Active session takes precedence over offline session if both are defined", () => {
  const activeSession = createMockSession("running", { id: "active-01", subjectName: "数学一" });
  const offlineSession = createMockSession("paused", { id: "offline-01", subjectName: "英语一" });

  const state = resolveDynamicIslandState({
    activeSession,
    offlineSession,
    elapsedSeconds: 600,
  });

  assert.equal(state.kind, "live_session_running");
  assert.equal(state.session?.id, "active-01");
  assert.equal(state.session?.subjectName, "数学一");
});

test("Priority Resolver: Completed or cancelled sessions fall through cleanly to lower states", () => {
  const completedSession = createMockSession("completed");
  const recovery: DynamicIslandRecoveryProps = { active: true, stage: 1, targetMinutes: 30 };

  const state = resolveDynamicIslandState({
    activeSession: completedSession,
    offlineSession: null,
    recovery,
    elapsedSeconds: 0,
  });

  assert.equal(state.kind, "recovery_active");
  assert.equal(state.stage, 1);
});

// ============================================================================
// SUITE 2: Abnormal Durations, Boundary Conditions & Time Formats
// ============================================================================

test("Time Formatter: formatClockDuration handles normal and extreme elapsed durations", () => {
  assert.equal(formatClockDuration(0), "00:00:00");
  assert.equal(formatClockDuration(45), "00:00:45");
  assert.equal(formatClockDuration(1530), "00:25:30");
  assert.equal(formatClockDuration(3600), "01:00:00");
  assert.equal(formatClockDuration(4530), "01:15:30");
  assert.equal(formatClockDuration(86400), "24:00:00");
  assert.equal(formatClockDuration(360000), "100:00:00");
  assert.equal(formatClockDuration(3599999), "999:59:59");
});

test("Time Formatter: formatClockDuration handles negative, NaN, and Infinite inputs without crashing", () => {
  assert.equal(formatClockDuration(-1), "00:00:00");
  assert.equal(formatClockDuration(-500), "00:00:00");
  assert.equal(formatClockDuration(-3600), "00:00:00");
  assert.equal(formatClockDuration(NaN), "00:00:00");
  assert.equal(formatClockDuration(Infinity), "00:00:00");
  assert.equal(formatClockDuration(-Infinity), "00:00:00");
});

test("Time Formatter: formatClockDuration handles sub-second and floating point values by flooring", () => {
  assert.equal(formatClockDuration(0.75), "00:00:00");
  assert.equal(formatClockDuration(59.99), "00:00:59");
  assert.equal(formatClockDuration(60.1), "00:01:00");
  assert.equal(formatClockDuration(3599.9), "00:59:59");
  assert.equal(formatClockDuration(3600.5), "01:00:00");
});

test("Timer Core: getTimerElapsedSeconds handles clock skew, negative differences, and huge pause intervals", () => {
  const baseTime = new Date("2026-08-27T10:00:00.000Z");

  // Normal running timer (30 min)
  const normalElapsed = getTimerElapsedSeconds({
    status: "running",
    startedAt: baseTime,
    accumulatedPauseSeconds: 0,
    now: new Date("2026-08-27T10:30:00.000Z"),
  });
  assert.equal(normalElapsed, 1800);

  // Running with pause deductions
  const pausedElapsed = getTimerElapsedSeconds({
    status: "running",
    startedAt: baseTime,
    accumulatedPauseSeconds: 300,
    now: new Date("2026-08-27T10:30:00.000Z"),
  });
  assert.equal(pausedElapsed, 1500);

  // Future startedAt (clock skew) -> clamps to 0
  const futureStarted = getTimerElapsedSeconds({
    status: "running",
    startedAt: new Date("2026-08-27T11:00:00.000Z"),
    accumulatedPauseSeconds: 0,
    now: baseTime,
  });
  assert.equal(futureStarted, 0);

  // Pause seconds exceeding elapsed time -> clamps to 0
  const excessivePause = getTimerElapsedSeconds({
    status: "running",
    startedAt: baseTime,
    accumulatedPauseSeconds: 5000,
    now: new Date("2026-08-27T10:30:00.000Z"),
  });
  assert.equal(excessivePause, 0);

  // Missing startedAt -> returns 0
  const missingStarted = getTimerElapsedSeconds({
    status: "running",
    startedAt: null as unknown as Date,
    accumulatedPauseSeconds: 0,
    now: baseTime,
  });
  assert.equal(missingStarted, 0);
});

// ============================================================================
// SUITE 3: Rapid State Toggles, Lifecycle Simulations & High-Volume Fuzzing
// ============================================================================

test("Lifecycle Simulation: Complete study flow transitions correctly across all 6 discrete stages", () => {
  let session: StudySessionDto | null = null;
  const syncState: DynamicIslandSyncState = "current";
  let recovery: DynamicIslandRecoveryProps | null = null;
  let eveningReview: DynamicIslandEveningReviewProps | null = null;

  // 1. Initial idle
  let state = resolveDynamicIslandState({ activeSession: session, offlineSession: null, syncState, recovery, eveningReview, elapsedSeconds: 0 });
  assert.equal(state.kind, "idle");

  // 2. Recovery triggers due to low conversion history
  recovery = { active: true, stage: 1, targetMinutes: 30, reason: "历史低转化" };
  state = resolveDynamicIslandState({ activeSession: session, offlineSession: null, syncState, recovery, eveningReview, elapsedSeconds: 0 });
  assert.equal(state.kind, "recovery_active");
  assert.equal(state.stage, 1);

  // 3. User starts a live session -> P0 preempts P3 recovery
  session = createMockSession("running", { id: "s-01", subjectName: "高等数学" });
  state = resolveDynamicIslandState({ activeSession: session, offlineSession: null, syncState, recovery, eveningReview, elapsedSeconds: 300 });
  assert.equal(state.kind, "live_session_running");
  assert.equal(state.session?.id, "s-01");

  // 4. User pauses session -> P2 paused state displays resume button
  session = createMockSession("paused", { id: "s-01", subjectName: "高等数学" });
  state = resolveDynamicIslandState({ activeSession: session, offlineSession: null, syncState, recovery, eveningReview, elapsedSeconds: 900 });
  assert.equal(state.kind, "activity_paused");
  assert.equal(state.elapsedSeconds, 900);

  // 5. User resumes session -> returns to P0 live running
  session = createMockSession("running", { id: "s-01", subjectName: "高等数学" });
  state = resolveDynamicIslandState({ activeSession: session, offlineSession: null, syncState, recovery, eveningReview, elapsedSeconds: 1500 });
  assert.equal(state.kind, "live_session_running");

  // 6. User initiates closeout -> P1 closing state
  session = createMockSession("closing", { id: "s-01", subjectName: "高等数学" });
  state = resolveDynamicIslandState({ activeSession: session, offlineSession: null, syncState, recovery, eveningReview, elapsedSeconds: 1800 });
  assert.equal(state.kind, "live_session_closing");

  // 7. Session closed -> falls back to P3 recovery
  session = null;
  state = resolveDynamicIslandState({ activeSession: session, offlineSession: null, syncState, recovery, eveningReview, elapsedSeconds: 0 });
  assert.equal(state.kind, "recovery_active");

  // 8. Recovery completed -> evening review becomes due (P4)
  recovery = { active: false, stage: 1, targetMinutes: 30 };
  eveningReview = { due: true, minimumActionDone: true, dailyReviewDone: false };
  state = resolveDynamicIslandState({ activeSession: session, offlineSession: null, syncState, recovery, eveningReview, elapsedSeconds: 0 });
  assert.equal(state.kind, "evening_review_due");

  // 9. Evening review completed -> returns to idle (P6)
  eveningReview = { due: false, minimumActionDone: true, dailyReviewDone: true };
  state = resolveDynamicIslandState({ activeSession: session, offlineSession: null, syncState, recovery, eveningReview, elapsedSeconds: 0 });
  assert.equal(state.kind, "idle");
});

test("Fuzzing & Permutation Matrix: 5000 randomized state permutations strictly satisfy priority invariant", () => {
  const statuses: Array<"running" | "closing" | "paused" | "completed" | null> = ["running", "closing", "paused", "completed", null];
  const syncStates: Array<DynamicIslandSyncState | undefined> = ["current", "deferred", "pending", "offline", "blocked", "unavailable", undefined];
  const booleanChoices = [true, false];

  const PRIORITY_MAP: Record<DynamicIslandCapsuleKind, number> = {
    live_session_running: 0,
    live_session_closing: 1,
    activity_paused: 2,
    recovery_active: 3,
    evening_review_due: 4,
    sync_issue: 5,
    idle: 6,
  };

  for (let i = 0; i < 5000; i++) {
    const activeStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const offlineStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const activeSession = activeStatus ? createMockSession(activeStatus) : null;
    const offlineSession = offlineStatus ? createMockSession(offlineStatus, { id: "offline-s" }) : null;
    const syncState = syncStates[Math.floor(Math.random() * syncStates.length)];
    const recoveryActive = booleanChoices[Math.floor(Math.random() * booleanChoices.length)];
    const eveningDue = booleanChoices[Math.floor(Math.random() * booleanChoices.length)];
    const elapsed = Math.floor(Math.random() * 7200) - 100;

    const result = resolveDynamicIslandState({
      activeSession,
      offlineSession,
      syncState,
      recovery: recoveryActive ? { active: true, stage: 2, targetMinutes: 60 } : null,
      eveningReview: eveningDue ? { due: true, minimumActionDone: false, dailyReviewDone: false } : null,
      elapsedSeconds: elapsed,
    });

    // Check priority correctness
    const expectedPriority = (() => {
      const primarySession = activeSession || offlineSession;
      if (primarySession?.status === "running") return 0;
      if (primarySession?.status === "closing") return 1;
      if (primarySession?.status === "paused") return 2;
      if (recoveryActive) return 3;
      if (eveningDue) return 4;
      if (syncState && syncState !== "current") return 5;
      return 6;
    })();

    assert.equal(
      PRIORITY_MAP[result.kind],
      expectedPriority,
      `Iteration ${i} failed: expected priority ${expectedPriority} but got ${result.kind}`
    );

    // Idempotence check
    const rerun = resolveDynamicIslandState({
      activeSession,
      offlineSession,
      syncState,
      recovery: recoveryActive ? { active: true, stage: 2, targetMinutes: 60 } : null,
      eveningReview: eveningDue ? { due: true, minimumActionDone: false, dailyReviewDone: false } : null,
      elapsedSeconds: elapsed,
    });
    assert.deepEqual(result, rerun, `Iteration ${i} must be purely idempotent`);
  }
});

// ============================================================================
// SUITE 4: Glow Styling Tokens & Drawer Transition Classes
// ============================================================================

test("Glow Styling: getCapsuleGlowStyle provides discrete glow styles when closed and clears style when open", () => {
  const kinds: DynamicIslandCapsuleKind[] = [
    "live_session_running",
    "live_session_closing",
    "activity_paused",
    "recovery_active",
    "evening_review_due",
    "sync_issue",
    "idle",
  ];

  for (const kind of kinds) {
    // When drawer is open, glow style is empty string
    assert.equal(getCapsuleGlowStyle(kind, true), "", `${kind} must return empty glow when drawer is open`);

    // When drawer is closed, glow style contains appropriate tone tokens
    const closedStyle = getCapsuleGlowStyle(kind, false);
    assert.ok(closedStyle.length > 0, `${kind} must have non-empty glow style when drawer is closed`);

    if (kind === "live_session_running") assert.match(closedStyle, /border-teal-500/);
    if (kind === "live_session_closing") assert.match(closedStyle, /border-emerald-500/);
    if (kind === "activity_paused") assert.match(closedStyle, /border-emerald-500/);
    if (kind === "recovery_active") assert.match(closedStyle, /border-amber-400/);
    if (kind === "evening_review_due") assert.match(closedStyle, /border-indigo-400/);
    if (kind === "sync_issue") assert.match(closedStyle, /border-amber-400/);
    if (kind === "idle") assert.match(closedStyle, /border-white\/10/);
  }
});

// ============================================================================
// SUITE 5: Codebase Structure & Banner Elimination Verification
// ============================================================================

test("Banner Purification: /today has completely eliminated TodayStatusBar", () => {
  const source = loadSource("components/action-center-today-view.tsx");
  assert.doesNotMatch(source, /function TodayStatusBar/);
  assert.doesNotMatch(source, /<TodayStatusBar/);
  assert.doesNotMatch(source, /today\.statusBar/);
});

test("Banner Purification: /knowledge overview page has removed bottom weak nodes callout card", () => {
  const source = loadSource("lib/routes/knowledge-overview-page.tsx");
  assert.doesNotMatch(source, /还有 .* 个考纲薄弱节点/);
  assert.doesNotMatch(source, /CircleAlert/);
});

test("Banner Purification: /roadmap/stages has eliminated static Alert banner and added action to SectionHeader", () => {
  const source = loadSource("lib/routes/plan-stages-page.tsx");
  assert.doesNotMatch(source, /<Alert/);
  assert.match(source, /StageDraftCreateAction/);
});

test("Banner Purification: /settings/exams has removed static cyan note card", () => {
  const source = loadSource("components/workspace-settings-client.tsx");
  assert.doesNotMatch(source, /科目管理入口：/);
});

test("Dynamic Island Architecture: GlobalTopBar and AppShell wire recovery, evening review, and direct resume", () => {
  const topBarSource = loadSource("components/global-top-bar.tsx");
  const shellSource = loadSource("components/app-shell.tsx");

  assert.match(topBarSource, /recovery=\{\s*props\.recovery\s*\}/);
  assert.match(topBarSource, /eveningReview=\{\s*props\.eveningReview\s*\}/);
  assert.match(topBarSource, /onResumeSession=\{\s*props\.onResumeSession\s*\}/);

  assert.match(shellSource, /handleResumeSession/);
  assert.match(shellSource, /recoveryProps/);
  assert.match(shellSource, /eveningReviewProps/);
});
