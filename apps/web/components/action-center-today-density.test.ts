import assert from "node:assert/strict";
import test from "node:test";
import {
  getHourlySlots,
  getSubjectProportionItems,
  getSubjectSparklineData,
  TodayLearningSummary,
  QueueList,
} from "./action-center-today-support";
import type { ActionCenterTodayDto } from "@/lib/contracts";

function createMockTodayDto(overrides: Partial<ActionCenterTodayDto> = {}): ActionCenterTodayDto {
  return {
    studyDate: "2026-08-26",
    isToday: true,
    setupRequired: false,
    workspace: {
      id: "ws-1",
      stableKey: "exam-2027",
      name: "考研冲刺工作区",
      targetExamDate: "2026-12-20",
      stageSummary: "强化阶段",
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
      title: "高数极值定理强化",
      reason: "突破薄弱考点",
      href: "/focus?taskId=task-1",
      softDependencyHint: null,
    },
    queues: {
      formalTasks: [
        {
          id: "task-1",
          kind: "task",
          title: "微分方程 10 题",
          reason: "今日计划",
          href: "/focus?taskId=task-1",
          softDependencyHint: null,
        },
      ],
      noteResourceSyllabusReviews: [
        {
          id: "rev-1",
          kind: "review",
          title: "考纲核心词汇卡片",
          reason: "到期复习",
          href: "/knowledge/reviews/card-1",
          softDependencyHint: null,
        },
      ],
      mistakeReviews: [
        {
          id: "mis-1",
          kind: "review",
          title: "真题错题重做",
          reason: "错题逾期 2 天",
          href: "/knowledge/reviews/mis-1",
          softDependencyHint: "前置考点未完全复习",
        },
      ],
    },
    queuesEmpty: false,
    activity: null,
    checkIn: null,
    learningLoop: {
      totalMinutes: 150,
      effectiveMinutes: 135,
      effectiveSessionCount: 4,
      lowConversionCount: 1,
      plannedTaskCount: 6,
      completedTaskCount: 4,
      deferredTaskCount: 1,
      reviewSubmitted: true,
      nextAction: "复习线性代数特征值",
      hourlyMinutes: [
        0, 0, 0, 0, 0, 0, 0, 0,
        25, 45, 0, 0, 0, 0, 30, 35,
        0, 0, 0, 0, 0, 0, 0, 0,
      ],
    },
    subjectTimers: {
      subjects: [
        {
          subjectId: "sub-math",
          title: "高等数学",
          groupId: "grp-1",
          groupTitle: "数学与专业课",
          todayEffectiveMinutes: 90,
          last7EffectiveMinutes: 380,
          contextSummary: "一元函数微分学",
          canStart: true,
        },
        {
          subjectId: "sub-eng",
          title: "考研英语",
          groupId: "grp-2",
          groupTitle: "公共课",
          todayEffectiveMinutes: 45,
          last7EffectiveMinutes: 210,
          contextSummary: "真题长难句",
          canStart: true,
        },
      ],
      groups: [
        {
          groupId: "grp-1",
          title: "数学与专业课",
          todayEffectiveMinutes: 90,
          last7EffectiveMinutes: 380,
          canStart: false,
        },
      ],
    },
    recovery: null,
    shortcutOptions: {
      tasks: [],
      syllabusNodes: [],
    },
    ...overrides,
  };
}

test("getHourlySlots: Returns 24 hourly buckets matching session distribution", () => {
  const todayWithHourly = createMockTodayDto();
  const slots = getHourlySlots(todayWithHourly);
  assert.equal(slots.length, 24);
  assert.equal(slots[8], 25);
  assert.equal(slots[9], 45);
  assert.equal(slots[14], 30);
  assert.equal(slots[15], 35);
  assert.equal(slots[0], 0);

  // Fallback when hourlyMinutes is omitted
  const todayFallback = createMockTodayDto({
    learningLoop: {
      totalMinutes: 100,
      effectiveMinutes: 90,
      effectiveSessionCount: 2,
      lowConversionCount: 0,
      plannedTaskCount: 2,
      completedTaskCount: 2,
      deferredTaskCount: 0,
      reviewSubmitted: false,
      nextAction: null,
    },
  });
  const fallbackSlots = getHourlySlots(todayFallback);
  assert.equal(fallbackSlots.length, 24);
  const totalFallbackSum = fallbackSlots.reduce((a, b) => a + b, 0);
  assert.equal(totalFallbackSum, 90);
});

test("getSubjectProportionItems: Computes proportional minutes per subject", () => {
  const today = createMockTodayDto();
  const items = getSubjectProportionItems(today);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "sub-math");
  assert.equal(items[0].minutes, 90);
  assert.equal(items[1].id, "sub-eng");
  assert.equal(items[1].minutes, 45);
});

test("getSubjectSparklineData: Generates 7-day trend array with non-negative values", () => {
  const today = createMockTodayDto();
  const mathSubject = today.subjectTimers.subjects[0];
  const sparkData = getSubjectSparklineData(mathSubject);
  assert.equal(sparkData.length, 7);
  assert.equal(sparkData[6], 90); // Last point is today's minutes
  sparkData.forEach((val) => assert.ok(val >= 0, `Value ${val} must be non-negative`));
});

test("TodayLearningSummary: Renders full high-density dashboard with micro-visualizations", () => {
  const today = createMockTodayDto();
  const element = TodayLearningSummary({ today });
  assert.ok(element != null);
  assert.equal(element.props.variant, "master");
  assert.equal(element.props.padding, "md");
  assert.equal(element.props.children.length, 3);
});

test("QueueList: Renders rich badges and priority levels for tasks, reviews, and mistakes", () => {
  const today = createMockTodayDto();
  const element = QueueList({
    items: today.queues.mistakeReviews,
    actionLabel: "立即复测",
  });
  assert.ok(element != null);
  assert.ok(element.props.className.includes("grid grid-cols-1 gap-3.5 md:grid-cols-2"));
});
