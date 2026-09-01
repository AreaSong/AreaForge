import assert from "node:assert/strict";
import test from "node:test";
import {
  computeGanttTimeBounds,
  computeMilestoneGanttPoint,
  computeStageGanttSpan,
} from "./roadmap-gantt-utils";
import type { PlanMilestoneDto, StagePlanDto } from "@/lib/contracts";

test("computeGanttTimeBounds calculates min, max, and now position accurately", () => {
  const fixedNow = new Date("2026-08-20T00:00:00.000Z");
  const stages: StagePlanDto[] = [
    {
      id: "stage-1",
      revision: 1,
      name: "强化阶段",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-09-30T00:00:00.000Z",
      goal: "完成408与高数一轮强化",
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
      subjectId: "sub-math",
      stableKey: "M1",
      title: "高数强化真题精练",
      targetDate: "2026-08-25T00:00:00.000Z",
      sortOrder: 1,
      status: "pending",
      revision: 1,
      archivedAt: null,
    },
  ];

  const bounds = computeGanttTimeBounds(stages, milestones, fixedNow);
  assert.ok(bounds.minTime < new Date("2026-08-01T00:00:00.000Z").getTime());
  assert.ok(bounds.maxTime > new Date("2026-09-30T00:00:00.000Z").getTime());
  assert.ok(bounds.nowPositionPercent > 0 && bounds.nowPositionPercent < 100);
  assert.equal(bounds.isNowInRange, true);
});

test("computeStageGanttSpan calculates span percentages and progress", () => {
  const fixedNow = new Date("2026-08-20T00:00:00.000Z");
  const stage: StagePlanDto = {
    id: "stage-1",
    revision: 1,
    name: "强化阶段",
    startDate: "2026-08-01T00:00:00.000Z",
    endDate: "2026-08-31T00:00:00.000Z",
    goal: "强化复习",
    mode: "strengthen",
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  const bounds = computeGanttTimeBounds([stage], [], fixedNow);
  const span = computeStageGanttSpan(stage, bounds, fixedNow);

  assert.equal(span.isCurrent, true);
  assert.equal(span.isPast, false);
  assert.ok(span.widthPercent > 0);
  assert.ok(span.progressPercent >= 50 && span.progressPercent <= 80);
  assert.equal(span.durationDays, 30);
  assert.equal(span.remainingDays, 11);
});

test("computeMilestoneGanttPoint detects completion and urgency", () => {
  const fixedNow = new Date("2026-08-20T00:00:00.000Z");
  const bounds = {
    minTime: new Date("2026-08-01T00:00:00.000Z").getTime(),
    maxTime: new Date("2026-08-31T00:00:00.000Z").getTime(),
    totalDurationMs: 30 * 24 * 60 * 60 * 1000,
    nowPositionPercent: 63.3,
    formattedMinDate: "08/01",
    formattedMaxDate: "08/31",
    isNowInRange: true,
  };

  const urgentMilestone: PlanMilestoneDto = {
    id: "m-1",
    workspaceId: "ws-1",
    stagePlanId: "stage-1",
    subjectId: "sub-1",
    stableKey: "M1",
    title: "408模考第一套",
    targetDate: "2026-08-24T00:00:00.000Z",
    sortOrder: 1,
    status: "pending",
    revision: 1,
    archivedAt: null,
  };

  const completedMilestone: PlanMilestoneDto = {
    id: "m-2",
    workspaceId: "ws-1",
    stagePlanId: "stage-1",
    subjectId: "sub-2",
    stableKey: "M2",
    title: "高数微分方程掌握",
    targetDate: "2026-08-10T00:00:00.000Z",
    sortOrder: 2,
    status: "completed",
    revision: 1,
    archivedAt: null,
  };

  const point1 = computeMilestoneGanttPoint(urgentMilestone, bounds, fixedNow);
  assert.equal(point1.isUrgent, true);
  assert.equal(point1.isCompleted, false);
  assert.equal(point1.daysUntil, 4);

  const point2 = computeMilestoneGanttPoint(completedMilestone, bounds, fixedNow);
  assert.equal(point2.isCompleted, true);
  assert.equal(point2.isUrgent, false);
});
