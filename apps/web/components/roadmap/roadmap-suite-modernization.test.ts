import assert from "node:assert/strict";
import test from "node:test";
import { computeSubjectConversionRows } from "./roadmap-budget-conversion";
import {
  computeGanttTimeBounds,
  computeMilestoneGanttPoint,
  computeStageGanttSpan,
} from "./roadmap-gantt-utils";
import type {
  AnalyticsSubjectShareDto,
  PlanMilestoneDto,
  StagePlanDto,
  SyllabusMapOverviewDto,
  WorkspaceSubjectDto,
} from "@/lib/contracts";

test("Roadmap: computeSubjectConversionRows accurately calculates budget, actual, and conversion efficiency", () => {
  const mockAnalyticsSubjects: AnalyticsSubjectShareDto[] = [
    {
      subjectId: "sub-math",
      subjectName: "高等数学",
      subjectColor: "#3b82f6",
      totalMinutes: 6510, // 108.5 h
      effectiveMinutes: 5996, // 99.9 h
      share: 45,
      activity: {
        studyMinutes: 5000,
        reviewMinutes: 1000,
        testMinutes: 510,
        totalMinutes: 6510,
        effectiveStudyMinutes: 4500,
        effectiveReviewMinutes: 900,
        effectiveTestMinutes: 510,
        studySessionCount: 20,
        reviewSessionCount: 5,
        testSessionCount: 2,
      },
    },
    {
      subjectId: "sub-408",
      subjectName: "408 计算机",
      subjectColor: "#10b981",
      totalMinutes: 6900, // 115 h
      effectiveMinutes: 5831, // 97.2 h
      share: 48,
      activity: {
        studyMinutes: 4000,
        reviewMinutes: 2000,
        testMinutes: 900,
        totalMinutes: 6900,
        effectiveStudyMinutes: 3500,
        effectiveReviewMinutes: 1800,
        effectiveTestMinutes: 900,
        studySessionCount: 25,
        reviewSessionCount: 8,
        testSessionCount: 3,
      },
    },
  ];

  const mockOverview: SyllabusMapOverviewDto = {
    nodes: [
      {
        id: "node-1",
        revision: 1,
        stableKey: "math-node-1",
        archivedAt: null,
        subjectId: "sub-math",
        subjectName: "高等数学",
        subjectColor: "#3b82f6",
        parentId: null,
        title: "高等数学考纲",
        kind: "chapter",
        status: "covered",
        masteryLevel: "exam_stable",
        masteryStatus: "STABLE",
        needsRetest: false,
        masteryConfidence: 95,
        sortOrder: 1,
        targetMinutes: 7200, // 120 h
        actualMinutes: 6510,
        evidence: {
          taskCount: 0,
          sessionCount: 5,
          noteCount: 2,
          mistakeCount: 0,
          lastEvidenceAt: "2026-08-10T00:00:00.000Z",
          daysSinceLastEvidence: 2,
          source: "explicit",
        },
        masteryConditions: [],
        masteryConditionRecords: [],
        masteryEvidence: [],
        masteryRetests: [],
        masteryEvidenceCandidates: {
          note: [],
          retest: [],
          task: [],
          session: [],
          mistake: [],
        },
        masteryProof: {
          allowedLevel: "exam_stable",
          canMarkRequestedLevel: true,
          requestedLevel: "exam_stable",
          evidenceCount: 5,
          evidenceTypes: ["note", "retest"],
          missingConditions: [],
          missingEvidence: [],
          risk: "ready",
          nextAction: "",
        },
        mapSignal: {
          cellStatus: "verified",
          markers: ["check"],
          reasons: [],
          nextAction: "",
        },
        children: [],
      },
    ],
    summary: {
      totalNodes: 1,
      coverageRate: 100,
      verificationRate: 100,
      counts: {
        not_started: 0,
        learning: 0,
        covered: 0,
        verified: 1,
        weak: 0,
        forgetting_risk: 0,
        mistake_hotspot: 0,
        deferred: 0,
      },
      riskLevel: "clear",
      recommendedFilters: [],
      focusNodeIds: [],
      nextActions: ["保持复测节奏"],
    },
    summaryBySubject: {},
  };

  const mockWorkspaceSubjects: WorkspaceSubjectDto[] = [
    {
      id: "sub-math",
      workspaceId: "ws-1",
      groupId: null,
      stableKey: "math",
      legacyCode: null,
      name: "高等数学 (自定)",
      color: "#3b82f6",
      sortOrder: 1,
      archivedAt: null,
      legacyScope: false,
    },
  ];

  const rows = computeSubjectConversionRows(mockAnalyticsSubjects, mockOverview, mockWorkspaceSubjects);

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

test("Roadmap: computeSubjectConversionRows handles edge cases (lag, low conversion, zero input)", () => {
  const edgeSubjects: AnalyticsSubjectShareDto[] = [
    {
      subjectId: "sub-lag",
      subjectName: "英语",
      subjectColor: "#f59e0b",
      totalMinutes: 1200, // 20 h actual
      effectiveMinutes: 960, // 16 h effective (80% conversion, but budget is 60h -> 33% progress -> lag)
      share: 10,
      activity: {
        studyMinutes: 1200,
        reviewMinutes: 0,
        testMinutes: 0,
        totalMinutes: 1200,
        effectiveStudyMinutes: 960,
        effectiveReviewMinutes: 0,
        effectiveTestMinutes: 0,
        studySessionCount: 5,
        reviewSessionCount: 0,
        testSessionCount: 0,
      },
    },
    {
      subjectId: "sub-low-conv",
      subjectName: "政治",
      subjectColor: "#ef4444",
      totalMinutes: 3600, // 60 h
      effectiveMinutes: 1800, // 30 h (50% conversion -> low_conversion)
      share: 20,
      activity: {
        studyMinutes: 3600,
        reviewMinutes: 0,
        testMinutes: 0,
        totalMinutes: 3600,
        effectiveStudyMinutes: 1800,
        effectiveReviewMinutes: 0,
        effectiveTestMinutes: 0,
        studySessionCount: 10,
        reviewSessionCount: 0,
        testSessionCount: 0,
      },
    },
  ];

  const overviewWithBudgets: SyllabusMapOverviewDto = {
    nodes: [
      {
        id: "node-eng",
        revision: 1,
        stableKey: "eng-1",
        archivedAt: null,
        subjectId: "sub-lag",
        subjectName: "英语",
        subjectColor: "#f59e0b",
        parentId: null,
        title: "英语长难句",
        kind: "chapter",
        status: "learning",
        masteryLevel: "learned",
        masteryStatus: "LEARNING",
        needsRetest: false,
        masteryConfidence: 50,
        sortOrder: 1,
        targetMinutes: 3600, // 60 h budget
        actualMinutes: 1200,
        evidence: {
          taskCount: 1,
          sessionCount: 2,
          noteCount: 0,
          mistakeCount: 0,
          lastEvidenceAt: null,
          daysSinceLastEvidence: null,
          source: "explicit",
        },
        masteryConditions: [],
        masteryConditionRecords: [],
        masteryEvidence: [],
        masteryRetests: [],
        masteryEvidenceCandidates: { task: [], session: [], note: [], mistake: [], retest: [] },
        masteryProof: {
          allowedLevel: "learned",
          canMarkRequestedLevel: true,
          requestedLevel: "learned",
          evidenceCount: 1,
          evidenceTypes: ["task"],
          missingConditions: [],
          missingEvidence: [],
          risk: "ready",
          nextAction: "",
        },
        mapSignal: { cellStatus: "learning", markers: [], reasons: [], nextAction: "" },
        children: [],
      },
    ],
    summary: {
      totalNodes: 1,
      coverageRate: 50,
      verificationRate: 0,
      counts: { not_started: 0, learning: 1, covered: 0, verified: 0, weak: 0, forgetting_risk: 0, mistake_hotspot: 0, deferred: 0 },
      riskLevel: "attention",
      recommendedFilters: [],
      focusNodeIds: [],
      nextActions: [],
    },
    summaryBySubject: {},
  };

  const rows = computeSubjectConversionRows(edgeSubjects, overviewWithBudgets, []);
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
