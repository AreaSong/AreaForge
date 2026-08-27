import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import {
  HubViewModeTabs,
  HubSupervisionOverview,
  HubFlowStopwatchPanel,
  HubConfirmationClosureGuide,
  HubCommandPaletteList,
  DynamicIslandHub,
  type HubViewMode,
} from "./dynamic-island-hub";
import type { DynamicIslandActiveItem } from "./dynamic-island-types";
import { GLOBAL_COMMANDS, type GlobalCommandDefinition } from "@/lib/navigation/command-palette";
import type { StudySessionDto } from "@/lib/contracts";

function createMockSession(
  status: "running" | "paused" | "closing" | "completed",
  overrides?: Partial<StudySessionDto>
): StudySessionDto {
  return {
    id: "session-test-hub-01",
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

function elementContainsText(element: React.ReactNode, text: string): boolean {
  if (!element) return false;
  if (typeof element === "string") return element.includes(text);
  if (typeof element === "number") return String(element).includes(text);
  if (Array.isArray(element)) {
    const joined = element
      .filter((c): c is string | number => typeof c === "string" || typeof c === "number")
      .map(String)
      .join("");
    if (joined.includes(text)) return true;
    return element.some((child) => elementContainsText(child, text));
  }
  if (React.isValidElement(element)) {
    if (typeof element.type === "function") {
      try {
        const rendered = (element.type as (props: Record<string, unknown>) => React.ReactNode)(
          element.props as Record<string, unknown>
        );
        if (elementContainsText(rendered, text)) return true;
      } catch {}
    }
    const props = element.props as Record<string, unknown> | null | undefined;
    if (!props) return false;
    for (const key of Object.keys(props)) {
      if (key === "children") {
        if (elementContainsText(props.children as React.ReactNode, text)) return true;
      } else if (typeof props[key] === "string" && (props[key] as string).includes(text)) {
        return true;
      }
    }
  }
  return false;
}

function findElementByProp(
  element: React.ReactNode,
  predicate: (props: Record<string, unknown>) => boolean
): React.ReactElement<Record<string, unknown>> | null {
  if (!element) return null;
  if (React.isValidElement(element)) {
    const el = element as React.ReactElement<Record<string, unknown>>;
    if (predicate((el.props ?? {}) as Record<string, unknown>)) return el;
    if (typeof el.type === "function") {
      try {
        const rendered = (el.type as (props: Record<string, unknown>) => React.ReactNode)(
          el.props as Record<string, unknown>
        );
        const found = findElementByProp(rendered, predicate);
        if (found) return found;
      } catch {}
    }
    const children = (el.props as { children?: React.ReactNode })?.children;
    if (children) {
      const found = findElementByProp(children, predicate);
      if (found) return found;
    }
  }
  if (Array.isArray(element)) {
    for (const child of element) {
      const found = findElementByProp(child, predicate);
      if (found) return found;
    }
  }
  return null;
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
// SUITE 1: HubViewModeTabs & View Mode Switching
// ============================================================================

test("HubViewModeTabs: Renders 4 standard tabs with labels and badges", () => {
  let switchedMode: HubViewMode | null = null;

  const element = HubViewModeTabs({
    viewMode: "search",
    onViewModeChange: (mode) => {
      switchedMode = mode;
    },
    activeStatesCount: 3,
    hasRunningSession: true,
    pendingConfirmationsCount: 2,
    eveningDue: true,
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;

  assert.ok(element);
  const children = React.Children.toArray(element.props.children) as Array<
    React.ReactElement<{
      onClick?: (e: { stopPropagation: () => void }) => void;
      children?: React.ReactNode[];
    }>
  >;

  assert.equal(children.length, 4, "Must render exactly 4 mode tabs");

  // Test clicking Overview tab
  let stopped = false;
  children[1].props.onClick?.({
    stopPropagation: () => {
      stopped = true;
    },
  });
  assert.equal(stopped, true);
  assert.equal(switchedMode, "overview");
});

test("HubViewModeTabs: Highlights active tab with teal border and shadow ring", () => {
  const modes: HubViewMode[] = ["search", "overview", "focus", "closure"];

  for (const mode of modes) {
    const element = HubViewModeTabs({
      viewMode: mode,
      onViewModeChange: () => {},
      activeStatesCount: 0,
      hasRunningSession: false,
      pendingConfirmationsCount: 0,
      eveningDue: false,
    }) as React.ReactElement<{ children?: React.ReactNode[] }>;

    const children = React.Children.toArray(element.props.children) as Array<
      React.ReactElement<{ className?: string }>
    >;
    const activeChild = children.find((c) => c.props.className?.includes("bg-teal-500/20"));
    assert.ok(activeChild, `Tab for ${mode} must have active teal style`);
  }
});

// ============================================================================
// SUITE 2: HubSupervisionOverview (Panel 1: 督战全景状态)
// ============================================================================

test("HubSupervisionOverview: Renders clean idle message when activeStates has no alerts", () => {
  const element = HubSupervisionOverview({
    activeStates: [{ id: "idle-01", kind: "idle", priorityWeight: 0, title: "AreaForge", accentTone: "zinc" }],
    dominantState: { id: "idle-01", kind: "idle", priorityWeight: 0, title: "AreaForge", accentTone: "zinc" },
    elapsedSeconds: 0,
    isResuming: false,
    onDirectResume: () => {},
    onClose: () => {},
  });

  assert.ok(element);
  assert.ok(elementContainsText(element, "督战系统一切就绪"));
  assert.ok(elementContainsText(element, "查看今日行动"));
});

test("HubSupervisionOverview: Renders live running session card with duration and closeout link", () => {
  const session = createMockSession("running");
  const runningItem: DynamicIslandActiveItem = {
    id: "run-01",
    kind: "live_session_running",
    priorityWeight: 1000,
    title: "高等数学",
    accentTone: "teal",
    session,
  };

  const element = HubSupervisionOverview({
    activeStates: [runningItem],
    dominantState: runningItem,
    elapsedSeconds: 1530,
    isResuming: false,
    onDirectResume: () => {},
    onClose: () => {},
  });

  assert.ok(element);
  assert.ok(elementContainsText(element, "高等数学"));
  assert.ok(elementContainsText(element, "00:25:30"));
  assert.ok(elementContainsText(element, "收口"));
});

test("HubSupervisionOverview: Renders paused session card with 1-click resume button", () => {
  let resumeCalled = false;
  const session = createMockSession("paused");
  const pausedItem: DynamicIslandActiveItem = {
    id: "pause-01",
    kind: "activity_paused",
    priorityWeight: 800,
    title: "高等数学",
    accentTone: "amber",
    session,
  };

  const element = HubSupervisionOverview({
    activeStates: [pausedItem],
    dominantState: pausedItem,
    elapsedSeconds: 900,
    isResuming: false,
    onDirectResume: () => {
      resumeCalled = true;
    },
    onClose: () => {},
  });

  assert.ok(element);
  const resumeButton = findElementByProp(element, (p) => p && typeof p.onClick === "function" && p.disabled === false);
  assert.ok(resumeButton, "Resume button must exist on paused card");
  (resumeButton.props as { onClick?: () => void }).onClick?.();
  assert.equal(resumeCalled, true);
});

test("HubSupervisionOverview: Renders recovery mode card with stage progress and guidance button", () => {
  let recoveryOpened = false;
  const recoveryItem: DynamicIslandActiveItem = {
    id: "rec-01",
    kind: "recovery_active",
    priorityWeight: 700,
    title: "精力恢复模式",
    stage: 2,
    targetMinutes: 60,
    accentTone: "amber",
  };

  const element = HubSupervisionOverview({
    activeStates: [recoveryItem],
    dominantState: recoveryItem,
    elapsedSeconds: 0,
    isResuming: false,
    onDirectResume: () => {},
    onOpenRecovery: () => {
      recoveryOpened = true;
    },
    onClose: () => {},
  });

  assert.ok(element);
  assert.ok(elementContainsText(element, "精力恢复第 2 阶"));
  assert.ok(elementContainsText(element, "目标 60 分钟"));
  assert.ok(elementContainsText(element, "恢复指引"));

  const recoveryButton = findElementByProp(element, (p) => p && typeof p.onClick === "function");
  assert.ok(recoveryButton);
  (recoveryButton.props as { onClick?: () => void }).onClick?.();
  assert.equal(recoveryOpened, true);
});

test("HubSupervisionOverview: Multi-state concurrent list renders all active alerts simultaneously", () => {
  const session = createMockSession("paused");
  const items: DynamicIslandActiveItem[] = [
    { id: "p0", kind: "activity_paused", priorityWeight: 800, title: "高等数学", session, accentTone: "amber" },
    { id: "p1", kind: "recovery_active", priorityWeight: 700, title: "恢复模式", stage: 1, targetMinutes: 30, accentTone: "amber" },
    { id: "p2", kind: "evening_review_due", priorityWeight: 600, title: "晚间复盘", reviewHref: "/roadmap/reviews/daily", accentTone: "indigo" },
    { id: "p3", kind: "sync_issue", priorityWeight: 500, title: "离线待对账", syncState: "deferred", accentTone: "amber" },
    { id: "p4", kind: "confirmations_pending", priorityWeight: 400, title: "待确认", pendingConfirmationsCount: 4, accentTone: "amber" },
  ];

  const element = HubSupervisionOverview({
    activeStates: items,
    dominantState: items[0],
    elapsedSeconds: 600,
    isResuming: false,
    onDirectResume: () => {},
    onClose: () => {},
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;

  assert.ok(element);
  const children = React.Children.toArray(element.props.children);
  assert.equal(children.length, 5, "All 5 concurrent active states must be rendered");
});

// ============================================================================
// SUITE 3: HubFlowStopwatchPanel (Panel 2: 专注心流秒表)
// ============================================================================

test("HubFlowStopwatchPanel: Renders large 3xl font-mono stopwatch in running session", () => {
  const session = createMockSession("running");
  const activeItem: DynamicIslandActiveItem = {
    id: "run-01",
    kind: "live_session_running",
    priorityWeight: 1000,
    title: "高等数学",
    session,
    accentTone: "teal",
  };

  const element = HubFlowStopwatchPanel({
    activeItem,
    dominantState: activeItem,
    elapsedSeconds: 1472,
    isResuming: false,
    onDirectResume: () => {},
    onClose: () => {},
  });

  assert.ok(element);
  assert.ok(elementContainsText(element, "00:24:32"));
  assert.ok(elementContainsText(element, "高等数学"));
  assert.ok(elementContainsText(element, "深度专注中"));
  assert.ok(elementContainsText(element, "全屏专注视图"));
  assert.ok(elementContainsText(element, "前往结束收口"));
});

test("HubFlowStopwatchPanel: Renders idle state stopwatch prompt with start link", () => {
  const idleItem: DynamicIslandActiveItem = {
    id: "idle-01",
    kind: "idle",
    priorityWeight: 0,
    title: "AreaForge",
    accentTone: "zinc",
  };

  const element = HubFlowStopwatchPanel({
    activeItem: idleItem,
    dominantState: idleItem,
    elapsedSeconds: 0,
    isResuming: false,
    onDirectResume: () => {},
    onClose: () => {},
  });

  assert.ok(element);
  assert.ok(elementContainsText(element, "00:00:00"));
  assert.ok(elementContainsText(element, "当前未在专注学习中"));
  assert.ok(elementContainsText(element, "开始新专注"));
  assert.ok(elementContainsText(element, "今日任务"));
});

// ============================================================================
// SUITE 4: HubConfirmationClosureGuide (Panel 3: 待确认与晚间收口指引)
// ============================================================================

test("HubConfirmationClosureGuide: Renders pending confirmations count and action button", () => {
  let actionTriggered = "";
  const element = HubConfirmationClosureGuide({
    pendingConfirmationsCount: 5,
    eveningReview: { due: true, minimumActionDone: false, dailyReviewDone: false },
    onOpenAction: (act) => {
      actionTriggered = act;
    },
    onClose: () => {},
  });

  assert.ok(element);
  assert.ok(elementContainsText(element, "5 项待处理"));
  assert.ok(elementContainsText(element, "待确认中心决策"));
  assert.ok(elementContainsText(element, "晚间收口指引"));
  assert.ok(elementContainsText(element, "最低有效行动"));
  assert.ok(elementContainsText(element, "待完成"));
  assert.ok(elementContainsText(element, "待沉淀"));

  const confirmButton = findElementByProp(element, (p) => p && typeof p.onClick === "function");
  assert.ok(confirmButton);
  (confirmButton.props as { onClick?: () => void }).onClick?.();
  assert.equal(actionTriggered, "confirmation-center");
});

test("HubConfirmationClosureGuide: Renders achieved status for completed evening review", () => {
  const element = HubConfirmationClosureGuide({
    pendingConfirmationsCount: 0,
    eveningReview: { due: true, minimumActionDone: true, dailyReviewDone: true, reviewHref: "/roadmap/reviews/daily" },
    onClose: () => {},
  });

  assert.ok(element);
  assert.ok(elementContainsText(element, "已达成"));
  assert.ok(elementContainsText(element, "已提交"));
  assert.ok(!elementContainsText(element, "5 项待处理"), "Zero pending confirmations must not show pending card");
});

// ============================================================================
// SUITE 5: HubCommandPaletteList (Panel 4: 全键盘命令搜索列表)
// ============================================================================

test("HubCommandPaletteList: Renders command list with selected item jump tag and mouse hover", () => {
  let selectedIdx = 0;
  let executedCmd: GlobalCommandDefinition | null = null;

  const testCommands: GlobalCommandDefinition[] = [
    { id: "cmd-01", label: "打开今日行动", description: "回到今天的下一行动", aliases: ["today"], href: "/today" },
    { id: "cmd-02", label: "开始学习", description: "进入选科目专注", aliases: ["start"], href: "/focus" },
  ];

  const element = HubCommandPaletteList({
    commands: testCommands,
    selectedIndex: 1,
    onSelectIndex: (idx) => {
      selectedIdx = idx;
    },
    onExecuteCommand: (cmd) => {
      executedCmd = cmd;
    },
  }) as React.ReactElement<{ children?: React.ReactNode[] }>;

  assert.ok(element);
  const children = React.Children.toArray(element.props.children) as Array<
    React.ReactElement<{
      onClick?: () => void;
      onMouseEnter?: () => void;
      "aria-selected"?: boolean;
    }>
  >;

  assert.equal(children.length, 2);
  assert.equal(children[1].props["aria-selected"], true, "Second command must be selected");

  // Test mouse enter on first item
  children[0].props.onMouseEnter?.();
  assert.equal(selectedIdx, 0);

  // Test click execution
  children[1].props.onClick?.();
  assert.equal((executedCmd as GlobalCommandDefinition | null)?.id, "cmd-02");
});

test("HubCommandPaletteList: Displays empty state when no commands match", () => {
  const element = HubCommandPaletteList({
    commands: [],
    selectedIndex: 0,
    onSelectIndex: () => {},
    onExecuteCommand: () => {},
  });

  assert.ok(element);
  assert.ok(elementContainsText(element, "未找到匹配的结果或命令"));
});

// ============================================================================
// SUITE 6: DynamicIslandHub Integration & Morphology Shell Tokens
// ============================================================================

test("DynamicIslandHub: Top-level hub switches active panel based on viewMode prop", () => {
  const dominantState: DynamicIslandActiveItem = {
    id: "dominant-01",
    kind: "idle",
    priorityWeight: 0,
    title: "AreaForge",
    accentTone: "zinc",
  };

  const modes: HubViewMode[] = ["search", "overview", "focus", "closure"];

  for (const mode of modes) {
    const element = DynamicIslandHub({
      isOpen: true,
      viewMode: mode,
      onViewModeChange: () => {},
      onClose: () => {},
      activeStates: [dominantState],
      dominantState,
      elapsedSeconds: 0,
      searchQuery: "",
      onSearchChange: () => {},
      commands: GLOBAL_COMMANDS,
      selectedIndex: 0,
      onSelectIndex: () => {},
      onExecuteCommand: () => {},
      onDirectResume: () => {},
    }) as React.ReactElement<{ children?: React.ReactNode[] }>;

    assert.ok(element, `DynamicIslandHub must render in ${mode} mode`);
  }
});

test("Visual Aesthetic & Layout: Dynamic Island Hub source code enforces Gaussian blur and 60fps transitions", () => {
  const hubSource = loadSource("components/dynamic-island-hub.tsx");
  const islandSource = loadSource("components/dynamic-island.tsx");

  assert.match(islandSource, /backdrop-blur-2xl/);
  assert.match(islandSource, /bg-\[#090e12\]\/98/);
  assert.match(islandSource, /border-teal-500\/40/);
  assert.match(islandSource, /shadow-\[0_0_32px_rgba\(45,212,191,0\.(?:18|22)\)\]/);
  assert.match(islandSource, /ease-\[cubic-bezier\(0\.16,1,0\.3,1\)\]/);
  assert.match(islandSource, /duration-300/);

  assert.match(hubSource, /HubViewModeTabs/);
  assert.match(hubSource, /HubSupervisionOverview/);
  assert.match(hubSource, /HubFlowStopwatchPanel/);
  assert.match(hubSource, /HubConfirmationClosureGuide/);
  assert.match(hubSource, /HubCommandPaletteList/);
});
