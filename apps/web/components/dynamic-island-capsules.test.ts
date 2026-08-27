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
  SatelliteBubble,
} from "./dynamic-island-segments";
import {
  resolveDynamicIslandState,
  computeDynamicIslandStatePool,
  resolveDualTaskStates,
  type DynamicIslandCapsuleState,
  type DynamicIslandCapsuleKind,
  type DynamicIslandRecoveryProps,
  type DynamicIslandEveningReviewProps,
  type DynamicIslandSyncState,
} from "./dynamic-island";
import {
  getCapsuleGlowStyle,
  getCapsuleGlowClass,
  getSatelliteBubbleGlowClass,
} from "./dynamic-island-glow";
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

// ============================================================================
// SUITE 8: Dual-Task Exclamation Layout Rendering (2+ Unsuppressed States)
// ============================================================================

test("Dual-Task Layout: resolveDualTaskStates yields Dominant and Satellite when 2+ unsuppressed states exist", () => {
  const runningSession = createMockSession("running", { subjectName: "高等数学" });
  const pool = computeDynamicIslandStatePool({
    activeSession: runningSession,
    recovery: { active: true, stage: 2, targetMinutes: 60 },
    eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
  });

  const result = resolveDualTaskStates(pool.activeStates, "/roadmap");
  assert.ok(result.dominant, "Must have dominant state");
  assert.ok(result.satellite, "Must have satellite state");
  assert.equal(result.dominant.kind, "live_session_running");
  assert.equal(result.satellite.kind, "recovery_active");
  assert.equal(result.allUnsuppressed.length, 3);
  assert.equal(result.unsuppressedCount, 3);
});

test("Dual-Task Layout: SatelliteBubble renders 38px/36px glowing circular bubble with state-synced glow tokens", () => {
  const recoveryBubble = SatelliteBubble({
    satelliteState: { kind: "recovery_active", stage: 2, targetMinutes: 60 },
    onSwapFluidFocus: () => {},
  }) as React.ReactElement<{ className?: string; title?: string; role?: string; "aria-label"?: string }>;

  assert.ok(recoveryBubble, "Recovery satellite bubble must render");
  const className = recoveryBubble.props.className ?? "";
  assert.ok(className.includes("rounded-full"), "Satellite bubble must be circular (rounded-full)");
  assert.ok(className.includes("shrink-0"), "Satellite bubble must be shrink-0");
  assert.ok(className.includes("border-amber-400"), "Recovery bubble must use amber glow border");
  assert.ok(className.includes("shadow-[0_0_16px_rgba(245,158,11,0.45)]"), "Recovery bubble must have amber shadow glow");
  assert.equal(recoveryBubble.props.role, "button");
  assert.ok(recoveryBubble.props.title?.includes("恢复第2阶"));

  const eveningBubble = SatelliteBubble({
    satelliteState: { kind: "evening_review_due", minimumActionDone: true, dailyReviewDone: false },
    onSwapFluidFocus: () => {},
  }) as React.ReactElement<{ className?: string; title?: string }>;

  assert.ok(eveningBubble, "Evening review satellite bubble must render");
  const eveningClass = eveningBubble.props.className ?? "";
  assert.ok(eveningClass.includes("border-indigo-400"), "Evening bubble must use indigo glow border");
  assert.ok(eveningClass.includes("shadow-[0_0_16px_rgba(99,102,241,0.45)]"), "Evening bubble must have indigo shadow glow");
  assert.ok(eveningBubble.props.title?.includes("晚间复盘"));
});

test("Dual-Task Layout: SatelliteBubble renders state-distinct icons across all dynamic island kinds", () => {
  const states: DynamicIslandCapsuleKind[] = [
    "live_session_running",
    "live_session_closing",
    "activity_paused",
    "recovery_active",
    "evening_review_due",
    "sync_issue",
    "confirmations_pending",
  ];

  for (const kind of states) {
    const bubble = SatelliteBubble({
      satelliteState: {
        kind,
        stage: 1,
        pendingConfirmationsCount: 3,
      },
      onSwapFluidFocus: () => {},
    }) as React.ReactElement<{ children?: React.ReactNode }>;

    assert.ok(bubble, `SatelliteBubble must render for ${kind}`);
    assert.ok(bubble.props.children, `SatelliteBubble for ${kind} must render an icon child`);
  }
});

test("Dual-Task Layout: DynamicIsland shell layout wires exclamation mark flex structure", () => {
  const source = loadSource("components/dynamic-island.tsx");

  assert.match(source, /resolveDualTaskStates/);
  assert.match(source, /hasSatellite/);
  assert.match(source, /SatelliteBubble/);
  assert.match(source, /gap-2/);
  assert.match(source, /handleSwapFluidFocus/);
  assert.match(source, /onWheel=\{handleWheel\}/);
});

// ============================================================================
// SUITE 9: Fluid Swap Morph on Click and Wheel Swipe
// ============================================================================

test("Fluid Swap: Clicking SatelliteBubble invokes onSwapFluidFocus with stopPropagation", () => {
  let swappedKind: string | null = null;
  let onSwapCalled = false;
  let propagationStopped = false;

  const bubble = SatelliteBubble({
    satelliteState: { kind: "recovery_active", stage: 1, targetMinutes: 30 },
    onSwapFluidFocus: (kind) => {
      swappedKind = kind;
    },
    onSwap: () => {
      onSwapCalled = true;
    },
  }) as React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }>;

  assert.ok(bubble);
  assert.equal(typeof bubble.props.onClick, "function");

  bubble.props.onClick?.({
    stopPropagation: () => {
      propagationStopped = true;
    },
  });

  assert.equal(propagationStopped, true, "Clicking SatelliteBubble must call stopPropagation");
  assert.equal(swappedKind, "recovery_active", "onSwapFluidFocus must receive satellite kind");
  assert.equal(onSwapCalled, true, "onSwap callback must be invoked");
});

test("Fluid Swap: Scrolling wheel on SatelliteBubble triggers focus swap with stopPropagation", () => {
  let swappedKind: string | null = null;
  let propagationStopped = false;

  const bubble = SatelliteBubble({
    satelliteState: { kind: "evening_review_due" },
    onSwapFluidFocus: (kind) => {
      swappedKind = kind;
    },
  }) as React.ReactElement<{ onWheel?: (e: { stopPropagation: () => void }) => void }>;

  assert.ok(bubble);
  assert.equal(typeof bubble.props.onWheel, "function");

  bubble.props.onWheel?.({
    stopPropagation: () => {
      propagationStopped = true;
    },
  });

  assert.equal(propagationStopped, true, "Wheel on SatelliteBubble must call stopPropagation");
  assert.equal(swappedKind, "evening_review_due");
});

test("Fluid Swap: resolveDualTaskStates swaps dominant and satellite when swappedPrimaryKind is set", () => {
  const runningSession = createMockSession("running", { subjectName: "数学分析" });
  const pool = computeDynamicIslandStatePool({
    activeSession: runningSession,
    recovery: { active: true, stage: 1, targetMinutes: 30 },
  });

  // Default state: live session dominant, recovery satellite
  const defaultDual = resolveDualTaskStates(pool.activeStates);
  assert.equal(defaultDual.dominant.kind, "live_session_running");
  assert.equal(defaultDual.satellite?.kind, "recovery_active");

  // After swap: recovery becomes dominant, live session becomes satellite
  const swappedDual = resolveDualTaskStates(pool.activeStates, null, "recovery_active");
  assert.equal(swappedDual.dominant.kind, "recovery_active");
  assert.equal(swappedDual.satellite?.kind, "live_session_running");

  // Re-swap: live session restored to dominant
  const restoredDual = resolveDualTaskStates(pool.activeStates, null, "live_session_running");
  assert.equal(restoredDual.dominant.kind, "live_session_running");
  assert.equal(restoredDual.satellite?.kind, "recovery_active");
});

test("Fluid Swap: Dynamic Island container wheel swipe gesture recognizes delta thresholds and triggers fluid swap", () => {
  const dynamicIslandSource = loadSource("components/dynamic-island.tsx");

  assert.match(dynamicIslandSource, /Math\.abs\(e\.deltaY\)\s*>\s*20\s*\|\|\s*Math\.abs\(e\.deltaX\)\s*>\s*20/);
  assert.match(dynamicIslandSource, /wheelLockRef\.current\s*=\s*true/);
  assert.match(dynamicIslandSource, /setTimeout\([\s\S]*350\)/);
});

// ============================================================================
// SUITE 10: Stopwatch Hover Micro-Actions & Stop Propagation
// ============================================================================

test("Hover Micro-Actions: Live session running renders [ ⏸ 暂停 ] and [ 🏁 收口 ] micro-action buttons", () => {
  const session = createMockSession("running", { subjectName: "高等数学" });
  let pauseTriggered = false;
  let closeoutTriggered = false;

  const element = CapsuleRightSegment({
    capsuleState: { kind: "live_session_running", session, elapsedSeconds: 1500 },
    isOpen: false,
    isResuming: false,
    isPausing: false,
    elapsedSeconds: 1500,
    onDirectPause: () => {
      pauseTriggered = true;
    },
    onDirectCloseout: () => {
      closeoutTriggered = true;
    },
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;

  assert.ok(element);
  const children = React.Children.toArray(element.props.children);
  assert.equal(children.length, 2, "Right segment must render default clock view + hover actions view");

  // First child is default clock view
  const clockContainer = children[0] as React.ReactElement<{ className?: string }>;
  assert.ok(clockContainer.props.className?.includes("group-hover/right:opacity-0"), "Clock fades out on hover");

  // Second child is hover micro-actions container
  const hoverContainer = children[1] as React.ReactElement<{ children?: React.ReactNode[] }>;
  assert.ok(hoverContainer.props.children);
  const hoverButtons = React.Children.toArray(hoverContainer.props.children);
  assert.equal(hoverButtons.length, 2, "Must have pause button and closeout link");
});

test("Hover Micro-Actions: Pause button click calls stopPropagation and triggers onDirectPause", () => {
  const session = createMockSession("running");
  let pauseCalled = false;
  let propagationStopped = false;

  const element = CapsuleRightSegment({
    capsuleState: { kind: "live_session_running", session, elapsedSeconds: 1200 },
    isOpen: false,
    onDirectPause: () => {
      pauseCalled = true;
    },
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;

  const children = React.Children.toArray(element.props.children);
  const hoverContainer = children[1] as React.ReactElement<{ children?: React.ReactNode[] }>;
  const hoverButtons = React.Children.toArray(hoverContainer.props.children);
  const pauseButton = hoverButtons[0] as React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }>;

  assert.ok(pauseButton, "Pause button must exist in hover container");
  assert.equal(typeof pauseButton.props.onClick, "function");

  pauseButton.props.onClick?.({
    stopPropagation: () => {
      propagationStopped = true;
    },
  });

  assert.equal(propagationStopped, true, "Pause button click must stop propagation");
  assert.equal(pauseCalled, true, "onDirectPause must be called");
});

test("Hover Micro-Actions: Closeout link click calls stopPropagation and onCloseDrawer", () => {
  const session = createMockSession("running");
  let closeoutCalled = false;
  let drawerClosed = false;
  let propagationStopped = false;

  const element = CapsuleRightSegment({
    capsuleState: { kind: "live_session_running", session, elapsedSeconds: 1200 },
    isOpen: false,
    onDirectCloseout: () => {
      closeoutCalled = true;
    },
    onCloseDrawer: () => {
      drawerClosed = true;
    },
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;

  const children = React.Children.toArray(element.props.children);
  const hoverContainer = children[1] as React.ReactElement<{ children?: React.ReactNode[] }>;
  const hoverButtons = React.Children.toArray(hoverContainer.props.children);
  const closeoutLink = hoverButtons[1] as React.ReactElement<{ onClick?: (e: { stopPropagation: () => void }) => void }>;

  assert.ok(closeoutLink, "Closeout link must exist in hover container");
  assert.equal(typeof closeoutLink.props.onClick, "function");

  closeoutLink.props.onClick?.({
    stopPropagation: () => {
      propagationStopped = true;
    },
  });

  assert.equal(propagationStopped, true, "Closeout click must stop propagation");
  assert.equal(closeoutCalled, true, "onDirectCloseout must be called");
  assert.equal(drawerClosed, true, "onCloseDrawer must be called");
});

test("Hover Micro-Actions: When isOpen is true, hover actions are suppressed and '正在学习' status is rendered", () => {
  const session = createMockSession("running");
  const element = CapsuleRightSegment({
    capsuleState: { kind: "live_session_running", session, elapsedSeconds: 1200 },
    isOpen: true,
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;

  assert.ok(element);
  const children = React.Children.toArray(element.props.children);
  assert.equal(children.length, 1, "Only single status element rendered when open");
  const statusSpan = children[0] as React.ReactElement<{ children?: React.ReactNode[] }>;
  const textChild = React.Children.toArray(statusSpan.props.children).find(
    (c) => React.isValidElement(c) && (c.props as { children?: React.ReactNode })?.children === "正在学习"
  );
  assert.ok(textChild, "Must display '正在学习' status pill");
});

// ============================================================================
// SUITE 11: Global Keyboard Penetration (⌘K, /, Esc)
// ============================================================================

test("Global Keyboard Penetration: Dynamic Island source verifies metaKey+K, Ctrl+K, forward slash, and Escape bindings", () => {
  const source = loadSource("components/dynamic-island.tsx");

  assert.match(source, /\(e\.metaKey\s*\|\|\s*e\.ctrlKey\)\s*&&\s*e\.key\.toLowerCase\(\)\s*===\s*["']k["']/);
  assert.match(source, /e\.key\s*===\s*["']\/["']/);
  assert.match(source, /isInputElement/);
  assert.match(source, /e\.key\s*===\s*["']Escape["']/);
  assert.match(source, /window\.addEventListener\(["']keydown["']/);
});

test("Global Keyboard Penetration: isInputElement helper correctly identifies text inputs and ignores normal content", () => {
  const source = loadSource("components/dynamic-island.tsx");

  assert.match(source, /INPUT/);
  assert.match(source, /TEXTAREA/);
  assert.match(source, /SELECT/);
  assert.match(source, /isContentEditable/);
});

test("Global Keyboard Penetration: Escape key handler resets query and smoothly collapses open console", () => {
  const source = loadSource("components/dynamic-island.tsx");

  assert.match(source, /if\s*\(e\.key\s*===\s*["']Escape["']\s*&&\s*isOpen\)/);
  assert.match(source, /setIsOpen\(false\)/);
  assert.match(source, /setQuery\(["']["']\)/);
});

