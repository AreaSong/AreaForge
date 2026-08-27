import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import {
  CapsuleLeftSegment,
  CapsuleCenterSegment,
  CapsuleRightSegment,
  CapsuleBreathingDots,
} from "./dynamic-island-segments";
import {
  resolveDynamicIslandState,
  computeDynamicIslandStatePool,
  type DynamicIslandCapsuleState,
  type DynamicIslandCapsuleKind,
  type DynamicIslandRecoveryProps,
  type DynamicIslandEveningReviewProps,
  type DynamicIslandSyncState,
} from "./dynamic-island";
import { getCapsuleGlowStyle, getCapsuleGlowClass } from "./dynamic-island-glow";
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
// SUITE 1: 3-Segment Partition Layout & Fine Divider Tokens
// ============================================================================

test("Capsule Layout: CapsuleLeftSegment renders fine right divider (border-r border-white/10) across all active states", () => {
  const session = createMockSession("running");
  const testStates: DynamicIslandCapsuleState[] = [
    { kind: "live_session_running", session, elapsedSeconds: 1200 },
    { kind: "live_session_closing", session, elapsedSeconds: 2400 },
    { kind: "activity_paused", session, elapsedSeconds: 900 },
    { kind: "recovery_active", stage: 2, targetMinutes: 60 },
    { kind: "evening_review_due", minimumActionDone: true, dailyReviewDone: false },
    { kind: "sync_issue", syncState: "deferred" },
    { kind: "confirmations_pending", pendingConfirmationsCount: 3 },
  ];

  for (const capsuleState of testStates) {
    const element = CapsuleLeftSegment({
      capsuleState,
      onTriggerOpen: () => {},
    }) as React.ReactElement<{ className?: string }>;

    assert.ok(element, `Left segment must render for ${capsuleState.kind}`);
    const className = element.props.className ?? "";
    assert.ok(
      className.includes("border-r"),
      `${capsuleState.kind} left segment must have 'border-r'`
    );
    assert.ok(
      className.includes("border-white/10"),
      `${capsuleState.kind} left segment must have 'border-white/10'`
    );
    assert.ok(
      className.includes("pr-2.5"),
      `${capsuleState.kind} left segment must have padding 'pr-2.5'`
    );
  }
});

test("Capsule Layout: CapsuleCenterSegment renders search input and hotkey badge", () => {
  let searchOpened = false;

  const element = CapsuleCenterSegment({
    query: "",
    onQueryChange: () => {},
    onOpenSearch: () => {
      searchOpened = true;
    },
    activeKind: "idle",
  }) as React.ReactElement<{ onClick?: () => void }>;

  assert.ok(element);
  assert.equal(typeof element.props.onClick, "function");
  element.props.onClick?.();
  assert.equal(searchOpened, true);
});

test("Capsule Layout: CapsuleRightSegment renders fine left divider (border-l border-white/10) across active states", () => {
  const session = createMockSession("running");
  const testStates: DynamicIslandCapsuleState[] = [
    { kind: "live_session_running", session, elapsedSeconds: 1200 },
    { kind: "live_session_closing", session, elapsedSeconds: 2400 },
    { kind: "activity_paused", session, elapsedSeconds: 900 },
    { kind: "recovery_active", stage: 2, targetMinutes: 60 },
    { kind: "evening_review_due", minimumActionDone: true, dailyReviewDone: false },
    { kind: "sync_issue", syncState: "deferred" },
    { kind: "confirmations_pending", pendingConfirmationsCount: 2 },
  ];

  for (const capsuleState of testStates) {
    const element = CapsuleRightSegment({
      capsuleState,
      isOpen: false,
      isResuming: false,
      elapsedSeconds: 1200,
      onTriggerOpen: () => {},
      onDirectResume: () => {},
      onRetrySync: () => {},
      onCloseDrawer: () => {},
    }) as React.ReactElement<{ className?: string }>;

    assert.ok(element, `Right segment must render for ${capsuleState.kind}`);
    const className = element.props.className ?? "";
    assert.ok(
      className.includes("border-l"),
      `${capsuleState.kind} right segment must have 'border-l'`
    );
    assert.ok(
      className.includes("border-white/10"),
      `${capsuleState.kind} right segment must have 'border-white/10'`
    );
    assert.ok(
      className.includes("pl-2.5"),
      `${capsuleState.kind} right segment must have padding 'pl-2.5'`
    );
  }
});

test("Capsule Layout: Idle state yields null for Left and Right segments to render unified search capsule", () => {
  const idleState: DynamicIslandCapsuleState = { kind: "idle" };

  const leftElement = CapsuleLeftSegment({
    capsuleState: idleState,
    onTriggerOpen: () => {},
  });
  assert.equal(leftElement, null, "Left segment must be null in idle state");

  const rightElement = CapsuleRightSegment({
    capsuleState: idleState,
    isOpen: false,
    isResuming: false,
    elapsedSeconds: 0,
    onTriggerOpen: () => {},
    onDirectResume: () => {},
    onCloseDrawer: () => {},
  });
  assert.equal(rightElement, null, "Right segment must be null in idle state");
});

test("Capsule Layout: CapsuleBreathingDots displays indicators only when count > 1", () => {
  const dotsSingle = CapsuleBreathingDots({ count: 1, activeIndex: 0 });
  assert.equal(dotsSingle, null, "Single state must not render breathing dots");

  const dotsMultiple = CapsuleBreathingDots({ count: 3, activeIndex: 1 }) as React.ReactElement<{
    children?: React.ReactNode[];
    "aria-label"?: string;
  }>;
  assert.ok(dotsMultiple, "Multiple states must render breathing dots container");
  assert.equal(React.Children.count(dotsMultiple.props.children), 3);
  assert.ok(dotsMultiple.props["aria-label"]?.includes("共 3 项"));
});

// ============================================================================
// SUITE 2: Partition Click Event Isolation & Stop Propagation
// ============================================================================

test("Event Isolation: CapsuleLeftSegment click handler stops propagation and triggers overview action", () => {
  let triggerCount = 0;
  let propagationStopped = false;

  const element = CapsuleLeftSegment({
    capsuleState: {
      kind: "recovery_active",
      stage: 1,
      targetMinutes: 30,
    },
    onTriggerOpen: () => {
      triggerCount++;
    },
  }) as React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }>;

  assert.ok(element);
  assert.equal(typeof element.props.onClick, "function");

  element.props.onClick?.({
    stopPropagation: () => {
      propagationStopped = true;
    },
  });

  assert.equal(propagationStopped, true, "Left segment click must stop propagation");
  assert.equal(triggerCount, 1, "Clicking left segment must invoke onTriggerOpen");
});

test("Event Isolation: CapsuleRightSegment direct actions stop propagation and execute dedicated handlers", () => {
  let directResumeCalled = false;
  let propagationStopped = false;

  const pausedSession = createMockSession("paused");
  const element = CapsuleRightSegment({
    capsuleState: {
      kind: "activity_paused",
      session: pausedSession,
      elapsedSeconds: 600,
    },
    isOpen: false,
    isResuming: false,
    elapsedSeconds: 600,
    onTriggerOpen: () => {},
    onDirectResume: () => {
      directResumeCalled = true;
    },
    onCloseDrawer: () => {},
  }) as React.ReactElement<{ children?: React.ReactNode }>;

  assert.ok(element);
  const children = React.Children.toArray(element.props.children) as Array<
    React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }>
  >;

  const button = children.find((c) => c.props && typeof c.props.onClick === "function");
  assert.ok(button, "Direct resume button must exist");

  button?.props.onClick?.({
    stopPropagation: () => {
      propagationStopped = true;
    },
  });

  assert.equal(propagationStopped, true, "Direct resume click must stop propagation");
  assert.equal(directResumeCalled, true, "onDirectResume must be called directly");
});

test("Event Isolation: CapsuleRightSegment Sync retry action executes with stopPropagation", () => {
  let retrySyncCalled = false;
  let propagationStopped = false;

  const element = CapsuleRightSegment({
    capsuleState: {
      kind: "sync_issue",
      syncState: "deferred",
    },
    isOpen: false,
    isResuming: false,
    elapsedSeconds: 0,
    onTriggerOpen: () => {},
    onDirectResume: () => {},
    onRetrySync: () => {
      retrySyncCalled = true;
    },
    onCloseDrawer: () => {},
  }) as React.ReactElement<{ children?: React.ReactNode }>;

  assert.ok(element);
  const children = React.Children.toArray(element.props.children) as Array<
    React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }>
  >;
  const button = children.find((c) => c.props && typeof c.props.onClick === "function");
  assert.ok(button, "Sync retry button must exist");

  button?.props.onClick?.({
    stopPropagation: () => {
      propagationStopped = true;
    },
  });

  assert.equal(propagationStopped, true, "Retry sync click must stop propagation");
  assert.equal(retrySyncCalled, true, "onRetrySync must be called on click");
});

// ============================================================================
// SUITE 3: Priority Resolution & Invariant Fuzzing
// ============================================================================

test("Priority Resolver: State Pool computes concurrent active states", () => {
  const pool = computeDynamicIslandStatePool({
    activeSession: createMockSession("running"),
    recovery: { active: true, stage: 1, targetMinutes: 30 },
  });
  assert.equal(pool.dominantState.kind, "live_session_running");
  assert.equal(pool.activeStates.length, 2);
});

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
    reason: "连续低转化",
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

test("Priority Resolver: P4 Evening Review Due overrides sync issue when no active session or recovery", () => {
  const eveningReview: DynamicIslandEveningReviewProps = {
    due: true,
    minimumActionDone: true,
    dailyReviewDone: false,
    reviewHref: "/roadmap/reviews/daily",
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

test("Priority Resolver: P5 Sync Issue triggers when offline/deferred sync is present and no higher state exists", () => {
  const stateDeferred = resolveDynamicIslandState({
    activeSession: null,
    offlineSession: null,
    syncState: "deferred",
    recovery: null,
    eveningReview: null,
    elapsedSeconds: 0,
  });
  assert.equal(stateDeferred.kind, "sync_issue");
  assert.equal(stateDeferred.syncState, "deferred");

  const stateOffline = resolveDynamicIslandState({
    activeSession: null,
    offlineSession: null,
    syncState: "offline",
    recovery: null,
    eveningReview: null,
    elapsedSeconds: 0,
  });
  assert.equal(stateOffline.kind, "sync_issue");
  assert.equal(stateOffline.syncState, "offline");
});

test("Priority Resolver: P7 Idle state is returned when no active session, recovery, review, or sync issues exist", () => {
  const state = resolveDynamicIslandState({
    activeSession: null,
    offlineSession: null,
    syncState: "current",
    recovery: { active: false, stage: 1, targetMinutes: 30 },
    eveningReview: { due: false, minimumActionDone: true, dailyReviewDone: true },
    elapsedSeconds: 0,
  });

  assert.equal(state.kind, "idle");
  assert.equal(state.session, undefined);
});

test("State Engine Invariants: 100 random combinations verify deterministic prioritization and idempotence", () => {
  const statuses: Array<"running" | "paused" | "closing" | "completed" | null> = [
    "running",
    "paused",
    "closing",
    "completed",
    null,
  ];
  const syncStates: Array<DynamicIslandSyncState | undefined> = [
    "current",
    "deferred",
    "offline",
    "pending",
    "blocked",
    "unavailable",
    undefined,
  ];

  const PRIORITY_MAP: Record<DynamicIslandCapsuleKind, number> = {
    live_session_running: 0,
    live_session_closing: 1,
    activity_paused: 2,
    recovery_active: 3,
    evening_review_due: 4,
    sync_issue: 5,
    confirmations_pending: 6,
    idle: 7,
  };

  for (let i = 0; i < 100; i++) {
    const activeStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const offlineStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const syncState = syncStates[Math.floor(Math.random() * syncStates.length)];
    const recoveryActive = Math.random() > 0.5;
    const eveningDue = Math.random() > 0.5;
    const elapsed = Math.floor(Math.random() * 7200);

    const activeSession = activeStatus ? createMockSession(activeStatus) : null;
    const offlineSession = offlineStatus ? createMockSession(offlineStatus, { id: "off-fuzz" }) : null;

    const result = resolveDynamicIslandState({
      activeSession,
      offlineSession,
      syncState,
      recovery: recoveryActive ? { active: true, stage: 2, targetMinutes: 60 } : null,
      eveningReview: eveningDue ? { due: true, minimumActionDone: false, dailyReviewDone: false } : null,
      elapsedSeconds: elapsed,
    });

    const expectedPriority = (() => {
      const primarySession = activeSession || offlineSession;
      if (primarySession?.status === "running") return 0;
      if (primarySession?.status === "closing") return 1;
      if (primarySession?.status === "paused") return 2;
      if (recoveryActive) return 3;
      if (eveningDue) return 4;
      if (syncState && syncState !== "current") return 5;
      return 7;
    })();

    assert.equal(
      PRIORITY_MAP[result.kind],
      expectedPriority,
      `Iteration ${i} failed: expected priority ${expectedPriority} but got ${result.kind}`
    );

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
// SUITE 4: Visual Aesthetic & Obsidian Glass Shell Tokens
// ============================================================================

test("Visual Aesthetic: Dynamic Island shell tokens enforce Obsidian glass and 60fps transitions", () => {
  const dynamicIslandSource = loadSource("components/dynamic-island.tsx");

  assert.match(dynamicIslandSource, /bg-\[#090e12\]\/98/);
  assert.match(dynamicIslandSource, /backdrop-blur-2xl/);
  assert.match(dynamicIslandSource, /z-\[var\(--af-layer-modal\)\]/);
  assert.match(dynamicIslandSource, /duration-300/);
  assert.match(dynamicIslandSource, /ease-\[cubic-bezier\(0\.16,1,0\.3,1\)\]/);
  assert.match(dynamicIslandSource, /rounded-\[18px\]/);
  assert.match(dynamicIslandSource, /rounded-\[20px\]/);
  assert.match(dynamicIslandSource, /keydown/);
  assert.match(dynamicIslandSource, /Escape/);
});

test("Glow Styling: getCapsuleGlowStyle provides discrete glow styles when closed and clears style when open", () => {
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
    assert.equal(getCapsuleGlowStyle(kind, true), "", `${kind} must return empty glow when drawer is open`);
    const closedStyle = getCapsuleGlowStyle(kind, false);
    assert.ok(closedStyle.length > 0, `${kind} must have non-empty glow style when drawer is closed`);

    if (kind === "live_session_running") assert.match(closedStyle, /border-teal-500/);
    if (kind === "live_session_closing") assert.match(closedStyle, /border-emerald-500/);
    if (kind === "activity_paused") assert.match(closedStyle, /border-emerald-500/);
    if (kind === "recovery_active") assert.match(closedStyle, /border-amber-400/);
    if (kind === "evening_review_due") assert.match(closedStyle, /border-indigo-400/);
    if (kind === "sync_issue") assert.match(closedStyle, /border-amber-400/);
    if (kind === "confirmations_pending") assert.match(closedStyle, /border-amber-400/);
    if (kind === "idle") assert.match(closedStyle, /border-white\/10/);
  }
});

test("Glow Styling: getCapsuleGlowClass matches tone tokens", () => {
  assert.ok(getCapsuleGlowClass("teal", false).includes("teal"));
  assert.ok(getCapsuleGlowClass("emerald", false).includes("emerald"));
});

// ============================================================================
// SUITE 5: Time Formatter & Dynamic Duration Invariants
// ============================================================================

test("Time Formatter: formatClockDuration handles zero, normal, extreme and invalid seconds safely", () => {
  assert.equal(formatClockDuration(0), "00:00:00");
  assert.equal(formatClockDuration(45), "00:00:45");
  assert.equal(formatClockDuration(1530), "00:25:30");
  assert.equal(formatClockDuration(3600), "01:00:00");
  assert.equal(formatClockDuration(4530), "01:15:30");
  assert.equal(formatClockDuration(86400), "24:00:00");
  assert.equal(formatClockDuration(-1), "00:00:00");
  assert.equal(formatClockDuration(NaN), "00:00:00");
});

test("Timer Core: getTimerElapsedSeconds handles clock skew, negative differences, and pause deductions", () => {
  const baseTime = new Date("2026-08-27T10:00:00.000Z");

  const normalElapsed = getTimerElapsedSeconds({
    status: "running",
    startedAt: baseTime,
    accumulatedPauseSeconds: 0,
    now: new Date("2026-08-27T10:30:00.000Z"),
  });
  assert.equal(normalElapsed, 1800);

  const pausedElapsed = getTimerElapsedSeconds({
    status: "running",
    startedAt: baseTime,
    accumulatedPauseSeconds: 300,
    now: new Date("2026-08-27T10:30:00.000Z"),
  });
  assert.equal(pausedElapsed, 1500);

  const futureStarted = getTimerElapsedSeconds({
    status: "running",
    startedAt: new Date("2026-08-27T11:00:00.000Z"),
    accumulatedPauseSeconds: 0,
    now: baseTime,
  });
  assert.equal(futureStarted, 0);
});

// ============================================================================
// SUITE 6: Banner Elimination & Zero-Regression Guard
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

// ============================================================================
// SUITE 7: Scene-Adaptive Fluid Morphology & Keyboard Integration
// ============================================================================

test("Morphology: Daily Idle state renders compact capsule with hotkey badge", () => {
  const left = CapsuleLeftSegment({
    capsuleState: { kind: "idle" },
    onTriggerOpen: () => {},
  });
  assert.equal(left, null, "Left segment must be null in idle mode");

  const right = CapsuleRightSegment({
    capsuleState: { kind: "idle" },
    isOpen: false,
    isResuming: false,
    elapsedSeconds: 0,
    onTriggerOpen: () => {},
    onDirectResume: () => {},
    onCloseDrawer: () => {},
  });
  assert.equal(right, null, "Right segment must be null in idle mode");

  const center = CapsuleCenterSegment({
    query: "",
    onQueryChange: () => {},
    onOpenSearch: () => {},
    activeKind: "idle",
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;
  assert.ok(center);
  const children = React.Children.toArray(center.props.children);
  const badge = children.find(
    (c) => React.isValidElement(c) && typeof (c.props as { className?: string })?.className === "string" && ((c.props as { className?: string }).className ?? "").includes("font-mono")
  );
  assert.ok(badge, "Idle mode must render Command+K hotkey badge");
});

test("Morphology: Live Session Running renders live flow stopwatch with ticking time and subject", () => {
  const session = createMockSession("running", { subjectName: "考研政治" });
  const left = CapsuleLeftSegment({
    capsuleState: { kind: "live_session_running", session, elapsedSeconds: 1472 },
    onTriggerOpen: () => {},
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;
  assert.ok(left);
  const leftChildren = React.Children.toArray(left.props.children);
  const titleSpan = leftChildren.find(
    (c) => React.isValidElement(c) && (c.props as { children?: React.ReactNode })?.children === "考研政治"
  );
  assert.ok(titleSpan, "Left segment must show subject name in live session");

  const right = CapsuleRightSegment({
    capsuleState: { kind: "live_session_running", session, elapsedSeconds: 1472 },
    isOpen: false,
    isResuming: false,
    elapsedSeconds: 1472,
    onTriggerOpen: () => {},
    onDirectResume: () => {},
    onCloseDrawer: () => {},
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;
  assert.ok(right);
  const rightChildren = React.Children.toArray(right.props.children);
  const clockContainer = rightChildren[0] as React.ReactElement<{ children?: React.ReactNode[] }>;
  assert.ok(clockContainer);
  const clockText = React.Children.toArray(clockContainer.props.children).find(
    (c) => React.isValidElement(c) && (c.props as { children?: React.ReactNode })?.children === "00:24:32"
  );
  assert.ok(clockText, "Right segment must display formatted 00:24:32 live stopwatch");
});

test("Morphology: Dynamic Island source verifies keyboard event bindings and modal layer", () => {
  const source = loadSource("components/dynamic-island.tsx");
  assert.match(source, /z-\[var\(--af-layer-modal\)\]/);
  assert.match(source, /ease-\[cubic-bezier\(0\.16,1,0\.3,1\)\]/);
  assert.match(source, /onViewModeChange/);
  assert.match(source, /DynamicIslandHub/);
});
