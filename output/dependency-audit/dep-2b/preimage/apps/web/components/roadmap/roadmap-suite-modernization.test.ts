import assert from "node:assert/strict";
import test from "node:test";
import { computeWeeklyBudgetConversionRows } from "./roadmap-budget-conversion";
import {
  computeGanttTimeBounds,
  computeMilestoneGanttPoint,
  computeStageGanttSpan,
} from "./roadmap-gantt-utils";
import type {
  PlanMilestoneDto,
  StagePlanDto,
  WeeklyBudgetDto,
} from "@/lib/contracts";

test("Roadmap: weekly budget rows calculate budget, actual, and conversion efficiency", () => {
  const budget: WeeklyBudgetDto = {
    workspaceId: "ws-1",
    weekStart: "2026-08-10",
    weekEnd: "2026-08-16",
    configuredSubjectCount: 2,
    totalTargetMinutes: 14_100,
    totalActualMinutes: 13_410,
    totalEffectiveMinutes: 11_827,
    subjects: [
      {
        subjectId: "sub-math",
        subjectName: "高等数学 (自定)",
        subjectColor: "#3b82f6",
        targetMinutes: 7200,
        actualMinutes: 6510,
        effectiveMinutes: 5996,
        revision: 1,
      },
      {
        subjectId: "sub-408",
        subjectName: "408 计算机",
        subjectColor: "#10b981",
        targetMinutes: 6900,
        actualMinutes: 6900,
        effectiveMinutes: 5831,
        revision: 1,
      },
    ],
  };

  const rows = computeWeeklyBudgetConversionRows(budget);

  assert.equal(rows.length, 2);
  const mathRow = rows.find((r) => r.subjectId === "sub-math");
  assert.ok(mathRow);
  assert.equal(mathRow.subjectName, "高等数学 (自定)");
  assert.equal(mathRow.budgetMinutes, 7200);
  assert.equal(mathRow.actualMinutes, 6510);
  assert.equal(mathRow.effectiveMinutes, 5996);
  assert.equal(mathRow.conversionRate, 92); // (5996 / 6510) * 100
  assert.equal(mathRow.progressRate, 90); // (6510 / 7200) * 100
  assert.equal(mathRow.status, "high");
  assert.equal(mathRow.statusLabel, "高效转化");
});

test("Roadmap: Gantt bounds calculation handles multiple stages and boundary conditions", () => {
  const fixedNow = new Date("2026-08-15T00:00:00.000Z");
  const stages: StagePlanDto[] = [
    {
      id: "stage-1",
      revision: 1,
      name: "基础筑基",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-07-31T00:00:00.000Z",
      goal: "全科考纲一轮过",
      mode: "maintain",
      status: "completed",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "stage-2",
      revision: 2,
      name: "强化突破",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-09-30T00:00:00.000Z",
      goal: "真题题型归纳与重难点突破",
      mode: "strengthen",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ];

  const milestones: PlanMilestoneDto[] = [
    {
      id: "m-1",
      workspaceId: "ws-1",
      stagePlanId: "stage-1",
      subjectId: null,
      stableKey: "M1",
      title: "基础导学课刷完",
      targetDate: "2026-07-20T00:00:00.000Z",
      sortOrder: 1,
      status: "completed",
      revision: 1,
      archivedAt: null,
    },
    {
      id: "m-2",
      workspaceId: "ws-1",
      stagePlanId: "stage-2",
      subjectId: null,
      stableKey: "M2",
      title: "408 十年真题一轮",
      targetDate: "2026-08-20T00:00:00.000Z",
      sortOrder: 2,
      status: "pending",
      revision: 1,
      archivedAt: null,
    },
  ];

  const bounds = computeGanttTimeBounds(stages, milestones, fixedNow);
  assert.ok(bounds.minTime <= new Date("2026-06-01T00:00:00.000Z").getTime());
  assert.ok(bounds.maxTime >= new Date("2026-09-30T00:00:00.000Z").getTime());

  const stage1Span = computeStageGanttSpan(stages[0], bounds, fixedNow);
  assert.equal(stage1Span.isPast, true);
  assert.equal(stage1Span.progressPercent, 100);

  const stage2Span = computeStageGanttSpan(stages[1], bounds, fixedNow);
  assert.equal(stage2Span.isCurrent, true);
  assert.ok(stage2Span.progressPercent > 0 && stage2Span.progressPercent < 100);

  const milestonePoint = computeMilestoneGanttPoint(milestones[1], bounds, fixedNow);
  assert.equal(milestonePoint.isUrgent, true); // Target is in 5 days (<= 7 days)
  assert.equal(milestonePoint.daysUntil, 5);
});

test("Roadmap: weekly budget rows handle lag and low conversion", () => {
  const budget: WeeklyBudgetDto = {
    workspaceId: "ws-1",
    weekStart: "2026-08-10",
    weekEnd: "2026-08-16",
    configuredSubjectCount: 2,
    totalTargetMinutes: 3900,
    totalActualMinutes: 1380,
    totalEffectiveMinutes: 1050,
    subjects: [
      {
        subjectId: "sub-lag",
        subjectName: "英语",
        subjectColor: "#f59e0b",
        targetMinutes: 3600,
        actualMinutes: 1200,
        effectiveMinutes: 960,
        revision: 1,
      },
      {
        subjectId: "sub-low-conv",
        subjectName: "政治",
        subjectColor: "#ef4444",
        targetMinutes: 300,
        actualMinutes: 180,
        effectiveMinutes: 90,
        revision: 1,
      },
    ],
  };

  const rows = computeWeeklyBudgetConversionRows(budget);
  assert.equal(rows.length, 2);

  const lagRow = rows.find((r) => r.subjectId === "sub-lag");
  assert.ok(lagRow);
  assert.equal(lagRow.status, "lag");
  assert.equal(lagRow.statusLabel, "需补投入");

  const lowConvRow = rows.find((r) => r.subjectId === "sub-low-conv");
  assert.ok(lowConvRow);
  assert.equal(lowConvRow.status, "low_conversion");
  assert.equal(lowConvRow.statusLabel, "转化偏低");
});
