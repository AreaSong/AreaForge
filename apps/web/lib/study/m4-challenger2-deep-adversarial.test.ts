import assert from "node:assert/strict";
import test from "node:test";
import {
  createArchiveCommand,
  formPayload,
  isMilestoneArchiveCommand,
  isMilestoneConflictLatest,
  isMilestoneCreatePayload,
  isMilestoneFormDraft,
  labelMilestoneError,
  milestoneConflictComparisons,
  nextMilestoneKey,
  samePayload,
  upsertMilestone,
} from "@/components/stage-milestone-utils";
import { formatPlanDay, formatShortDate } from "@/components/plan-rolling-day-list";
import {
  createDraftSnapshot,
  flattenSyllabusNodes,
  isTaskCreateDraft,
} from "@/components/plan-rolling-utils";
import {
  buildPlanInboxConflictComparisons,
  detailHref,
  planInboxDraftsEqual,
  planInboxStatusLabel,
  shanghaiDateOffset,
  toPlanInboxFormDraft,
} from "@/components/plan-inbox-item-utils";
import { planInboxOriginLabel } from "@/components/plan-inbox-origin";
import { readReportHistorySnapshot } from "@/lib/study/report-history-snapshot";
import type { PlanInboxItemDto, PlanMilestoneDto, SyllabusOptionNodeDto } from "@/lib/contracts";

test("adversarial m4: stage milestone key generation handles gaps and dense collisions", () => {
  assert.equal(nextMilestoneKey([]), "milestone-1");

  const rows1: PlanMilestoneDto[] = [
    { id: "1", workspaceId: "w", stagePlanId: "s", stableKey: "milestone-1", title: "T1", targetDate: null, subjectId: null, sortOrder: 0, status: "active", revision: 1, archivedAt: null },
    { id: "2", workspaceId: "w", stagePlanId: "s", stableKey: "milestone-2", title: "T2", targetDate: null, subjectId: null, sortOrder: 1, status: "active", revision: 1, archivedAt: null },
  ];
  assert.equal(nextMilestoneKey(rows1), "milestone-3");

  // With a gap: length is 2, milestone-3 is present but milestone-1 and milestone-2 are not
  const rowsWithGap: PlanMilestoneDto[] = [
    { id: "1", workspaceId: "w", stagePlanId: "s", stableKey: "milestone-3", title: "T1", targetDate: null, subjectId: null, sortOrder: 0, status: "active", revision: 1, archivedAt: null },
    { id: "2", workspaceId: "w", stagePlanId: "s", stableKey: "milestone-4", title: "T2", targetDate: null, subjectId: null, sortOrder: 1, status: "active", revision: 1, archivedAt: null },
  ];
  // length is 2, suffix starts at 3, but milestone-3 and milestone-4 exist, so it should pick milestone-5
  assert.equal(nextMilestoneKey(rowsWithGap), "milestone-5");
});

test("adversarial m4: stage milestone payload generation preserves trimming and date conversion", () => {
  const draft = {
    baseRevision: 999,
    stableKey: "   milestone-trim-test   ",
    title: "   Trimmed Title   ",
    targetDate: "2026-10-15",
    firstSubmittedPayload: null,
  };
  const payload = formPayload(draft, "stage-alpha", 5);
  assert.equal(payload.stagePlanId, "stage-alpha");
  assert.equal(payload.expectedStagePlanRevision, 999);
  assert.equal(payload.stableKey, "milestone-trim-test");
  assert.equal(payload.title, "Trimmed Title");
  assert.equal(payload.targetDate, "2026-10-14T16:00:00.000Z");
  assert.equal(payload.sortOrder, 5);

  const emptyDateDraft = { ...draft, targetDate: "" };
  const payloadNoDate = formPayload(emptyDateDraft, "stage-alpha", 0);
  assert.equal(payloadNoDate.targetDate, null);
});

test("adversarial m4: upsertMilestone produces immutable updates", () => {
  const initial: PlanMilestoneDto[] = [
    { id: "m1", workspaceId: "w", stagePlanId: "s", stableKey: "k1", title: "T1", targetDate: null, subjectId: null, sortOrder: 0, status: "active", revision: 1, archivedAt: null },
  ];
  const updated: PlanMilestoneDto = {
    id: "m1", workspaceId: "w", stagePlanId: "s", stableKey: "k1", title: "T1-modified", targetDate: "2026-10-01T00:00:00.000Z", subjectId: "sub1", sortOrder: 0, status: "active", revision: 2, archivedAt: null,
  };
  const result = upsertMilestone(initial, updated);
  assert.notEqual(result, initial);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "T1-modified");
  assert.equal(result[0].revision, 2);
  assert.equal(initial[0].title, "T1"); // original array unmodified
});

test("adversarial m4: milestone validators reject malformed payloads strictly", () => {
  assert.equal(isMilestoneConflictLatest({ kind: "plan-milestone" }), true);
  assert.equal(isMilestoneConflictLatest({ kind: "other-kind" }), false);
  assert.equal(isMilestoneConflictLatest(null), false);
  assert.equal(isMilestoneConflictLatest("string"), false);
  assert.equal(isMilestoneConflictLatest([]), false);

  assert.equal(isMilestoneFormDraft({
    baseRevision: 1,
    stableKey: "k",
    title: "t",
    targetDate: "invalid-date",
    firstSubmittedPayload: null,
  }), false);

  assert.equal(isMilestoneArchiveCommand({
    milestoneId: "m1",
    desiredArchived: true,
    baseRevision: 1,
    firstSubmittedPayload: { expectedRevision: 1, archive: true },
    firstSubmittedSnapshot: { id: "m1", revision: 1 },
  }), true);

  assert.equal(isMilestoneArchiveCommand({
    milestoneId: "m1",
    desiredArchived: true,
    baseRevision: "1", // wrong type
  }), false);
});

test("adversarial m4: plan rolling utils flatten nested syllabus trees accurately", () => {
  const tree: SyllabusOptionNodeDto[] = [
    {
      id: "root-1",
      subjectId: "math",
      title: "Calculus",
      children: [
        {
          id: "child-1",
          subjectId: "math",
          title: "Limits",
          children: [
            {
              id: "grandchild-1",
              subjectId: "math",
              title: "Squeeze Theorem",
              children: [],
            },
          ],
        },
      ],
    },
    {
      id: "root-2",
      subjectId: "english",
      title: "Reading",
      children: [],
    },
  ];

  const flattened = flattenSyllabusNodes(tree);
  assert.equal(flattened.length, 4);
  assert.equal(flattened[0].id, "root-1");
  assert.equal(flattened[0].depth, 0);
  assert.equal(flattened[1].id, "child-1");
  assert.equal(flattened[1].depth, 1);
  assert.equal(flattened[2].id, "grandchild-1");
  assert.equal(flattened[2].depth, 2);
  assert.equal(flattened[3].id, "root-2");
  assert.equal(flattened[3].depth, 0);
});

test("adversarial m4: task create draft snapshots serialization and validation", () => {
  const snapshot = createDraftSnapshot({
    subjectId: "sub-1",
    syllabusNodeId: "node-1",
    relatedSyllabusNodeIds: ["node-2", "node-3"],
    stagePlanIds: ["stage-1"],
    knowledgePointIds: ["kp-1"],
    planMilestoneId: "m-1",
    title: "Deep Calculus Study",
    taskType: "study",
    priority: "critical",
    estimatedMinutes: 60,
  });

  assert.equal(isTaskCreateDraft(snapshot), true);
  assert.equal(snapshot.subjectId, "sub-1");
  assert.equal(snapshot.estimatedMinutes, 60);

  assert.equal(isTaskCreateDraft({ ...snapshot, priority: "INVALID_PRIORITY" }), false);
  assert.equal(isTaskCreateDraft({ ...snapshot, estimatedMinutes: "60" }), false);
});

test("adversarial m4: plan-inbox date offset calculation across month boundaries", () => {
  const offset0 = shanghaiDateOffset(0);
  const offset1 = shanghaiDateOffset(1);
  const offset7 = shanghaiDateOffset(7);
  const offsetMinus1 = shanghaiDateOffset(-1);

  assert.match(offset0, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(offset1, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(offset7, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(offsetMinus1, /^\d{4}-\d{2}-\d{2}$/);

  // Verifying monotonic increasing order
  assert.ok(offset0 <= offset1);
  assert.ok(offset1 <= offset7);
  assert.ok(offsetMinus1 <= offset0);
});

test("adversarial m4: plan inbox item equality and conflict comparisons", () => {
  const item: PlanInboxItemDto = {
    id: "inbox-item-1",
    workspaceId: "ws-1",
    originType: "DAILY_REVIEW_MINIMUM",
    originKey: "daily-key-1",
    originVersion: 1,
    originSnapshot: { summary: "Review notes" },
    stableKey: "sk-1",
    sourceStableKey: "src-1",
    title: "Tomorrow Minimum",
    subjectId: "sub-1",
    plannedDate: "2026-10-01T00:00:00.000Z",
    estimatedMinutes: 30,
    priority: "HIGH",
    type: "study",
    planMilestoneId: "m-1",
    primaryNodeId: "node-1",
    relatedNodeIds: ["node-2"],
    status: "OPEN",
    supersededByItemId: null,
    convertedTaskId: null,
    missingFields: [],
    requiredMilestoneKey: null,
    revision: 2,
    dependencyRefs: [
      { id: "dep-1", targetType: "TASK", taskId: "task-prev", importBatchId: null, dependencyType: "HARD", planStableKey: null, planOriginVersion: null },
    ],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  const draft = toPlanInboxFormDraft(item);
  assert.equal(draft.predecessors.length, 1);
  assert.equal(draft.predecessors[0].taskId, "task-prev");
  assert.equal(draft.predecessors[0].dependencyType, "HARD");

  const comparisons = buildPlanInboxConflictComparisons(draft, 2, item, {
    conflictFields: ["title", "revision"],
    latest: { ...item, revision: 3, title: "Server Updated Title" },
    firstSubmissionSnapshot: null,
  }, null);

  assert.ok(comparisons.some((c: { field: string; server?: unknown }) => c.field === "title" && c.server === "Server Updated Title"));
  assert.ok(comparisons.some((c: { field: string; server?: unknown }) => c.field === "revision" && c.server === 3));

  assert.equal(planInboxOriginLabel("DAILY_REVIEW_MINIMUM"), "来自今日复盘");
  assert.equal(planInboxOriginLabel("AI_PLAN"), "来自 AI 计划草稿");
  assert.equal(planInboxOriginLabel("SIMULATION_LOSS"), "来自模拟考试补救");
  assert.equal(planInboxOriginLabel("RECOVERY_MINIMUM"), "来自恢复最小行动");
  assert.equal(planInboxOriginLabel("RETEST_FOLLOW_UP"), "来自专项复测补强");
  assert.equal(planInboxOriginLabel("UNKNOWN_ORIGIN"), "投入草稿");
});

test("adversarial m4: report history snapshot robustness with corrupted or legacy inputs", () => {
  // Empty / null snapshot fails gracefully
  const emptySnapshot = readReportHistorySnapshot(null);
  assert.equal(emptySnapshot.format, "legacy");
  assert.equal(emptySnapshot.metrics.effectiveMinutes, null);

  // Non-object primitive
  const stringSnapshot = readReportHistorySnapshot("corrupted string payload");
  assert.equal(stringSnapshot.format, "legacy");

  // Current format snapshot
  const currentPayload = {
    metrics: {
      effectiveMinutes: 120,
      taskCompletionRate: 0.85,
      reviewCompletionRate: 1.0,
      debtCount: 0,
      completedTaskCount: 5,
      taskCount: 6,
      reviewCount: 7,
      lowConversionCount: 1,
      dueNoteCount: 2,
      weakNodeCount: 1,
    },
    weakness: {
      title: "Math Weakness",
      detail: "Integration needs work",
      reasons: ["Failed retest"],
    },
    strategy: {
      mustPressIssue: "Double integration practice",
      calmConclusion: "Keep calm",
    },
  };
  const currentSnapshot = readReportHistorySnapshot(currentPayload);
  assert.equal(currentSnapshot.format, "current");
  assert.equal(currentSnapshot.metrics.effectiveMinutes, 120);
  assert.equal(currentSnapshot.weakness?.title, "Math Weakness");
});
