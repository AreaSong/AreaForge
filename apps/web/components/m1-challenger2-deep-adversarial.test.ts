import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  QueueList,
  TodayLearningSummary,
  flattenShortcutNodes,
  hasRemainingAction,
  isSameActionTarget,
  withTodayReturnTo,
} from "./action-center-today-support";
import {
  ConfirmationCenter,
} from "./confirmation-center";
import type {
  ActionCenterTodayDto,
  ConfirmationItemDto,
} from "@/lib/contracts";

function loadSource(relPath: string): string {
  const normalized = relPath.replace(/^apps\/web\//, "");
  const candidates = [
    resolve(process.cwd(), relPath),
    resolve(process.cwd(), normalized),
    resolve(process.cwd(), "apps/web", normalized),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }
  }
  throw new Error(`Could not find source file for ${relPath}`);
}

// Helper to inspect React element tree
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inspectElement(element: any): { type: any; props: any } {
  assert.ok(element != null, "Element must not be null or undefined");
  return {
    type: element.type,
    props: element.props ?? {},
  };
}

// Mock mockTodayDto factory
function createMockTodayDto(overrides: Partial<ActionCenterTodayDto> = {}): ActionCenterTodayDto {
  return {
    studyDate: "2026-08-26",
    isToday: true,
    setupRequired: false,
    workspace: {
      id: "ws-1",
      stableKey: "exam-2027",
      name: "考研 2027 冲刺工作区",
      targetExamDate: "2026-12-20",
      stageSummary: "强化冲刺",
      status: "ACTIVE",
      revision: 1,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    },
    statusBar: null,
    primaryActionLabel: "开始今日推荐",
    primaryActionHref: "/focus?taskId=task-1",
    recommendation: {
      id: "rec-1",
      kind: "task",
      priorityBand: "today_high_priority_task",
      title: "高数复习：极限计算 10 题",
      reason: "昨日遗留的错题集重点攻克",
      href: "/focus?taskId=task-1",
      softDependencyHint: "建议先复习洛必达法则基础知识点",
    },
    queues: {
      formalTasks: [],
      noteResourceSyllabusReviews: [],
      mistakeReviews: [],
    },
    queuesEmpty: false,
    activity: null,
    checkIn: null,
    learningLoop: {
      totalMinutes: 120,
      effectiveMinutes: 95,
      effectiveSessionCount: 3,
      lowConversionCount: 1,
      plannedTaskCount: 5,
      completedTaskCount: 3,
      deferredTaskCount: 1,
      reviewSubmitted: false,
      nextAction: "整理高数错题本第 3 节",
    },
    subjectTimers: {
      subjects: [
        {
          subjectId: "math",
          title: "高等数学",
          groupId: "group-1",
          groupTitle: "数学与专业课",
          todayEffectiveMinutes: 60,
          last7EffectiveMinutes: 320,
          contextSummary: "极限、导数、不定积分",
          canStart: true,
        },
        {
          subjectId: "english",
          title: "考研英语",
          groupId: "group-2",
          groupTitle: "公共课",
          todayEffectiveMinutes: 35,
          last7EffectiveMinutes: 180,
          contextSummary: "真题阅读 2 篇精读",
          canStart: true,
        },
      ],
      groups: [
        {
          groupId: "group-2",
          title: "公共课",
          todayEffectiveMinutes: 35,
          last7EffectiveMinutes: 180,
          canStart: false,
        },
      ],
    },
    recovery: null,
    shortcutOptions: {
      tasks: [
        {
          id: "task-1",
          subjectId: "math",
          title: "高数真题计算",
          syllabusNodeId: "node-1",
          syllabusNodeTitle: "高等数学",
          disabledReason: null,
        },
        {
          id: "task-2",
          subjectId: "english",
          title: "英语作文初稿",
          syllabusNodeId: null,
          syllabusNodeTitle: null,
          disabledReason: "今日已完成",
        },
      ],
      syllabusNodes: [
        {
          id: "node-1",
          title: "高等数学",
          subjectId: "math",
          children: [
            {
              id: "node-1-1",
              title: "函数极限",
              subjectId: "math",
              children: [],
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

function createMockConfirmationItem(overrides: Partial<ConfirmationItemDto> = {}): ConfirmationItemDto {
  return {
    id: "conf-1",
    kind: "periodic_report",
    sourceId: "rep-1",
    revision: 1,
    status: "PENDING",
    requiresUserConfirmation: true,
    confirmedAt: null,
    frozenAt: null,
    title: "第 34 周学习复盘周报",
    summary: "总有效学习 24.5 小时，数学重点突破",
    href: "/confirmations?id=conf-1",
    sourceHref: "/roadmap/reviews?id=rep-1",
    sourceLabel: "周复盘报告",
    createdAt: "2026-08-26T00:00:00.000Z",
    action: {
      kind: "periodic_report",
      reportId: "rep-1",
      reportKind: "week",
      expectedRevision: 1,
      rangeStart: "2026-08-19T00:00:00.000Z",
      rangeEnd: "2026-08-26T00:00:00.000Z",
    },
    frozen: false,
    ...overrides,
  };
}

// ============================================================================
// SUITE 1: /today Action Center Edge Cases & Empty State Rendering
// ============================================================================

test("Today Action Center: setupRequired renders content-focus PageFrame and setup CTA", () => {
  const source = loadSource("components/action-center-today-view.tsx");

  // 1. SetupRequired early-return
  assert.match(source, /if\s*\(today\.setupRequired\)\s*return\s*<TodaySetupRequired\s*\/>/);

  // 2. SetupRequired component uses content-focus and warning Alert
  assert.match(source, /<PageFrame variant="content-focus">/);
  assert.match(source, /<Alert tone="warning">尚未设置考试工作区。不展示伪造统计。<\/Alert>/);
  assert.match(source, /href="\/settings\/exams\?setup=1"/);
});

test("Today Action Center: Empty queue state renders subtle card and friendly description", () => {
  const emptyQueueElement = QueueList({
    items: [],
    actionLabel: "去完成",
  });
  const emptyQueueInspect = inspectElement(emptyQueueElement);
  assert.equal(emptyQueueInspect.props.variant, "subtle");
  assert.ok(emptyQueueInspect.props.className.includes("flex flex-col items-center justify-center"));
  
  const [icon, title, desc] = emptyQueueInspect.props.children;
  assert.ok(icon != null);
  assert.equal(title.props.children, "当前推荐之外没有待办");
  assert.equal(desc.props.children, "今日安排已全部就绪或已在推荐卡片中呈现");
});

test("Today Action Center: Populated queues render responsive 2-column grid and soft dependency alerts", () => {
  const items = [
    {
      id: "q-1",
      title: "英语真题阅读 Text 1",
      reason: "核心难句精析",
      href: "/focus?taskId=eng-1",
      softDependencyHint: "需先完成生词背诵",
    },
    {
      id: "q-2",
      title: "政治马原第二章习题",
      reason: "对立统一规律专项",
      href: "/knowledge/reviews/card-pol-1",
      softDependencyHint: null,
    },
  ];

  const element = QueueList({ items, actionLabel: "去完成" });
  const { props } = inspectElement(element);
  assert.ok(props.className.includes("grid grid-cols-1 gap-3.5 md:grid-cols-2"));
  assert.equal(props.children.length, 2);

  const card1 = inspectElement(props.children[0]);
  assert.equal(card1.props.variant, "subtle");
  const card1Body = card1.props.children[0];
  const softHint = card1Body.props.children[2];
  assert.ok(softHint != null);
  assert.ok(softHint.props.className.includes("border-amber-400/20"));

  const card2 = inspectElement(props.children[1]);
  const card2Body = card2.props.children[0];
  const noSoftHint = card2Body.props.children[2];
  assert.equal(noSoftHint, null);
});

// ============================================================================
// SUITE 2: Learning Loop Summary & Recovery Banner Architecture
// ============================================================================

test("Today Action Center: Learning Loop Summary renders Master SectionCard and 4 subtle metrics", () => {
  const todayDto = createMockTodayDto({
    learningLoop: {
      totalMinutes: 180,
      effectiveMinutes: 150,
      effectiveSessionCount: 5,
      lowConversionCount: 0,
      plannedTaskCount: 6,
      completedTaskCount: 6,
      deferredTaskCount: 0,
      reviewSubmitted: true,
      nextAction: "明日开始模拟真题",
    },
  });

  const element = TodayLearningSummary({ today: todayDto });
  const { props } = inspectElement(element);
  assert.equal(props.variant, "master");

  const [, metricGrid, statusBlock] = props.children;
  assert.ok(metricGrid.props.className.includes("grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4"));
  assert.equal(metricGrid.props.children.length, 4);

  // Check review status styling
  const statusRows = statusBlock.props.children;
  const reviewRow = statusRows[1].props.children[0];
  const reviewStatusStrong = reviewRow.props.children[1];
  assert.equal(reviewStatusStrong.props.children, "已收口");
  assert.ok(reviewStatusStrong.props.className.includes("text-teal-300"));
});

test("Today Action Center: Recovery Details handles EXPIRED and ACTIVE states cleanly in source", () => {
  const source = loadSource("components/action-center-today-support.tsx");

  // 1. Default open when EXPIRED
  assert.match(source, /const\s*\[open,\s*setOpen\]\s*=\s*useState\(recovery\.effectiveStatus\s*===\s*"EXPIRED"\)/);

  // 2. EXPIRED status warning role and revision display
  assert.match(source, /recovery\.effectiveStatus\s*===\s*"EXPIRED"/);
  assert.match(source, /恢复窗口已到期（旧记录 r\{recovery\.revision\}/);
  assert.match(source, /重新开始恢复/);
  assert.match(source, /href="\/roadmap\/allocation"/);
});

test("Today Action Center: Status Bar renders three discrete tones for recovery, pause, and evening", () => {
  const source = loadSource("components/action-center-today-view.tsx");

  // 1. StatusBar tones and messages
  assert.match(source, /status === "recovery_minimum" \? "warning" : "info"/);
  assert.match(source, /活动已暂停，可继续当前行动/);
  assert.match(source, /恢复模式：先完成一个最小行动/);
  assert.match(source, /晚间提醒：最低行动或复盘尚未闭环/);
});

// ============================================================================
// SUITE 3: PinnedActionBar Responsiveness & Viewport Zero-Scroll Guarantees
// ============================================================================

test("PinnedActionBar in /today: Layout tokens, text truncation, and responsive wrap", () => {
  const source = loadSource("components/action-center-today-view.tsx");

  // 1. Sticky PinnedActionBar at page bottom
  assert.match(source, /<PinnedActionBar[\s\S]*mode="sticky"[\s\S]*className="mt-6"/);

  // 2. Left slot summary metrics and truncation
  assert.match(source, /今日投入 \{today\.learningLoop\.totalMinutes\} 分/);
  assert.match(source, /有效学习 \{today\.learningLoop\.effectiveMinutes\} 分/);
  assert.match(source, /truncate max-w-\[200px\] sm:max-w-\[280px\] text-zinc-400/);

  // 3. Right slot action cluster
  assert.match(source, /创建最小任务/);
  assert.match(source, /快速复盘/);
  assert.match(source, /开始今日推荐/);
  assert.match(source, /shadow-\[0_0_16px_rgba\(45,212,191,0\.35\)\]/);
});

test("PinnedActionBar in /confirmations: Safety notices and primary/danger action cluster", () => {
  const source = loadSource("components/confirmation-detail-actions.tsx");

  // 1. Sticky PinnedActionBar
  assert.match(source, /<PinnedActionBar[\s\S]*mode="sticky"[\s\S]*className="mt-6"/);

  // 2. Safety notice on left
  assert.match(source, /确认将冻结当前事实/);
  assert.match(source, /驳回或作废不会静默删除来源记录/);

  // 3. Right slot actions
  assert.match(source, /variant="danger"/);
  assert.match(source, /variant="primary"/);
  assert.match(source, /shadow-\[0_0_16px_rgba\(45,212,191,0\.35\)\]/);
});

// ============================================================================
// SUITE 4: CAS Revision Conflict Simulation & Modal Triggers
// ============================================================================

test("CAS Revision Conflict: Error labeling maps all 6 revision conflict codes to explicit user messages", () => {
  const source = loadSource("components/confirmation-detail-actions.tsx");

  const conflictCodes = [
    "PERIODIC_REPORT_REVISION_CONFLICT",
    "PERIODIC_REPORT_DECISION_CONFLICT",
    "STAGE_ADJUSTMENT_DRAFT_REVISION_CONFLICT",
    "SIMULATION_EXAM_REVISION_CONFLICT",
    "KNOWLEDGE_RETEST_CONFIRM_REVISION_CONFLICT",
    "KNOWLEDGE_RETEST_VOID_REVISION_CONFLICT",
  ];

  for (const code of conflictCodes) {
    assert.match(source, new RegExp(code), `Error mapping must handle ${code}`);
  }

  assert.match(source, /当前版本已经变化，请刷新页面后重新核对。原命令没有自动重放。/);
});

test("CAS Revision Conflict: ConflictResolutionModal integration and comparison extraction", () => {
  const source = loadSource("components/confirmation-detail-actions.tsx");

  // 1. ConflictResolutionModal mounted
  assert.match(source, /<ConflictResolutionModal/);
  assert.match(source, /open=\{conflictOpen && Boolean\(conflict\)\}/);
  assert.match(source, /title="处理确认版本冲突"/);
  assert.match(source, /adoptLabel="采用服务端版本"/);
  assert.match(source, /mergeLabel="保留命令并重试"/);

  // 2. Latest revision candidate extraction from nested report or draft
  assert.match(source, /record\?\.revision/);
  assert.match(source, /readRecord\(record\?\.report\)\?\.revision/);
  assert.match(source, /readRecord\(record\?\.draft\)\?\.revision/);
});

test("CAS Revision Conflict: Terminal and safe states fail closed without mutating", () => {
  const source = loadSource("components/confirmation-detail-actions.tsx");

  // 1. Already completed/frozen check
  assert.match(source, /if\s*\(item\.status\s*!==\s*"PENDING"\)\s*\{[\s\S]*return\s*<Alert tone="neutral">该事项已经处理/);

  // 2. Missing action check
  assert.match(source, /if\s*\(!action\)\s*\{[\s\S]*return\s*<Alert tone="info">该事项需要回到来源页面/);

  // 3. AI draft source proof requirement
  assert.match(source, /if\s*\(action\.kind\s*===\s*"ai_draft"\)\s*\{/);
  assert.match(source, /AI 草稿不能在确认中心直接确认或驳回，必须回到来源页面/);
});

// ============================================================================
// SUITE 5: Global Confirmation Center Standalone & Multi-Kind Cards
// ============================================================================

test("ConfirmationCenter Standalone: empty states for pending vs history filters", () => {
  const pendingEmpty = ConfirmationCenter({ items: [], filter: "pending" });
  const pendingInspect = inspectElement(pendingEmpty);
  assert.equal(pendingInspect.props.title, "当前没有待确认事项");
  assert.ok(pendingInspect.props.description.includes("需要你决定的结果会统一出现在这里"));

  const historyEmpty = ConfirmationCenter({ items: [], filter: "history" });
  const historyInspect = inspectElement(historyEmpty);
  assert.equal(historyInspect.props.title, "还没有已处理记录");
  assert.ok(historyInspect.props.description.includes("确认或驳回的报告、阶段建议和模拟考试会保留在这里"));
});

test("ConfirmationCenter Standalone: renders all confirmation item kinds with 2-column responsive layout", () => {
  const items: ConfirmationItemDto[] = [
    createMockConfirmationItem({
      id: "conf-1",
      kind: "periodic_report",
      title: "第 34 周学习复盘周报",
      summary: "总有效学习 24.5 小时，数学重点突破",
      revision: 1,
      status: "PENDING",
      sourceLabel: "周复盘报告",
      sourceHref: "/roadmap/reviews?id=rep-1",
      href: "/confirmations?id=conf-1",
    }),
    createMockConfirmationItem({
      id: "conf-2",
      kind: "stage_adjustment",
      title: "冲刺阶段复习权重微调建议",
      summary: "增加专业课二试题比重至 40%",
      revision: 2,
      status: "REJECTED",
      sourceLabel: "阶段调整草稿",
      sourceHref: "/roadmap/stages?id=draft-1",
      href: "/confirmations?id=conf-2",
      action: null,
    }),
    createMockConfirmationItem({
      id: "conf-3",
      kind: "knowledge_retest",
      title: "极限计算专项复测结果",
      summary: "得分 92/100，掌握度评级上升至 Level 4",
      revision: 1,
      status: "CONFIRMED",
      frozen: true,
      sourceLabel: "专项复测",
      sourceHref: "/test/retests/ret-1",
      href: "/confirmations?id=conf-3",
      action: null,
    }),
  ];

  const element = ConfirmationCenter({ items, filter: "pending" });
  const { props } = inspectElement(element);
  assert.ok(props.className.includes("grid grid-cols-1 gap-4 md:grid-cols-2"));
  assert.equal(props.children.length, 3);
});

// ============================================================================
// SUITE 6: Deep Property & Helper Invariants
// ============================================================================

test("Today Action Center Helpers: withTodayReturnTo handles complex queries, hashes, and non-target URLs", () => {
  assert.equal(
    withTodayReturnTo("/focus?mode=pomodoro&timer=25"),
    "/focus?mode=pomodoro&timer=25&returnTo=%2Ftoday",
  );
  assert.equal(
    withTodayReturnTo("/knowledge/reviews/card-1?stage=2"),
    "/knowledge/reviews/card-1?stage=2&returnTo=%2Ftoday",
  );
  assert.equal(
    withTodayReturnTo("/roadmap/allocation/tasks/t-1"),
    "/roadmap/allocation/tasks/t-1?returnTo=%2Ftoday",
  );

  // Non-target URLs (must remain unchanged)
  assert.equal(withTodayReturnTo("/roadmap/reviews"), "/roadmap/reviews");
  assert.equal(withTodayReturnTo("/settings/exams?setup=1"), "/settings/exams?setup=1");
  assert.equal(withTodayReturnTo("/test/simulations/sim-1"), "/test/simulations/sim-1");
  assert.equal(withTodayReturnTo(""), "");
});

test("Today Action Center Helpers: isSameActionTarget compares base routes ignoring queries and params", () => {
  assert.equal(isSameActionTarget("/focus?a=1&b=2", "/focus?c=3"), true);
  assert.equal(isSameActionTarget("/focus", "/focus"), true);
  assert.equal(isSameActionTarget("/knowledge/reviews/1?a=b", "/knowledge/reviews/2?a=b"), false);
  assert.equal(isSameActionTarget("/today", "/today?date=2026-08-26"), true);
});

test("Today Action Center Helpers: hasRemainingAction handles empty arrays and duplicate routes", () => {
  assert.equal(hasRemainingAction([], "/focus"), false);
  assert.equal(
    hasRemainingAction(
      [{ href: "/focus?taskId=1" }, { href: "/focus?taskId=2" }],
      "/focus",
    ),
    false,
  );
  assert.equal(
    hasRemainingAction(
      [{ href: "/focus" }, { href: "/roadmap/allocation/tasks/1" }],
      "/focus",
    ),
    true,
  );
});

test("Today Action Center Helpers: flattenShortcutNodes handles 10-level deep syllabus tree hierarchy", () => {
  type Node = ActionCenterTodayDto["shortcutOptions"]["syllabusNodes"][number];
  
  let current: Node = { id: "node-10", title: "Level 10 Node", subjectId: "sub-1", children: [] };
  for (let i = 9; i >= 1; i--) {
    current = {
      id: `node-${i}`,
      title: `Level ${i} Node`,
      subjectId: "sub-1",
      children: [current],
    };
  }

  const flattened = flattenShortcutNodes([current]);
  assert.equal(flattened.length, 10);
  for (let i = 0; i < 10; i++) {
    assert.equal(flattened[i].id, `node-${i + 1}`);
    assert.equal(flattened[i].depth, i);
  }
});

