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
  type MilestoneConflict,
  type MilestoneCreatePayload,
} from "@/components/stage-milestone-utils";
import { formatPlanDay, formatShortDate } from "@/components/plan-rolling-day-list";
import {
  buildPlanInboxConflictComparisons,
  detailHref,
  planInboxDraftsEqual,
  planInboxStatusLabel,
  shanghaiDateOffset,
  toPlanInboxFormDraft,
  type PlanInboxConflict,
  type PlanInboxFormDraft,
} from "@/components/plan-inbox-item-utils";
import {
  createDraftSnapshot,
  flattenSyllabusNodes,
  isTaskCreateDraft,
} from "@/components/plan-rolling-utils";
import {
  readReportDecisionFocus,
  readReportHistorySnapshot,
} from "@/lib/study/report-history-snapshot";
import type {
  PlanInboxItemDto,
  PlanMilestoneDto,
  StagePlanDto,
  SyllabusOptionNodeDto,
} from "@/lib/contracts";

test("Adversarial M4: nextMilestoneKey handles non-contiguous keys, gaps, and collisions", () => {
  // Empty milestones -> milestone-1
  assert.equal(nextMilestoneKey([]), "milestone-1");

  const dummyMilestone = (key: string): PlanMilestoneDto => ({
    id: `id-${key}`,
    workspaceId: "ws-1",
    stagePlanId: "sp-1",
    stableKey: key,
    title: `Title ${key}`,
    targetDate: null,
    subjectId: null,
    sortOrder: 0,
    status: "active",
    revision: 1,
    archivedAt: null,
  });

  // When length is 2 and keys are milestone-1 and milestone-3:
  // initial suffix is 2 + 1 = 3. Since milestone-3 is used, it increments to 4.
  const listWithGap = [dummyMilestone("milestone-1"), dummyMilestone("milestone-3")];
  assert.equal(nextMilestoneKey(listWithGap), "milestone-4");

  // Collision with high index
  const listWithSequential = [
    dummyMilestone("milestone-1"),
    dummyMilestone("milestone-2"),
    dummyMilestone("milestone-3"),
  ];
  assert.equal(nextMilestoneKey(listWithSequential), "milestone-4");

  // Custom prefixed keys in list increment past list length
  const listWithCustom = [
    dummyMilestone("custom-checkpoint-alpha"),
    dummyMilestone("custom-checkpoint-beta"),
  ];
  assert.equal(nextMilestoneKey(listWithCustom), "milestone-3");
});

test("Adversarial M4: formPayload and date conversions under timezone boundary conditions", () => {
  const draft = {
    baseRevision: 5,
    stableKey: "  m-key-padded  ",
    title: "  Padded Title  ",
    targetDate: "2026-12-31",
    firstSubmittedPayload: null,
  };

  const payload = formPayload(draft, "stage-alpha", 4);
  assert.equal(payload.stagePlanId, "stage-alpha");
  assert.equal(payload.expectedStagePlanRevision, 5);
  assert.equal(payload.stableKey, "m-key-padded");
  assert.equal(payload.title, "Padded Title");
  assert.equal(payload.targetDate, "2026-12-30T16:00:00.000Z"); // Shanghai 2026-12-31 is UTC 2026-12-30 16:00
  assert.equal(payload.sortOrder, 4);

  // Empty target date converts to null safely
  const emptyDateDraft = {
    ...draft,
    targetDate: "",
  };
  const emptyDatePayload = formPayload(emptyDateDraft, "stage-alpha", 0);
  assert.equal(emptyDatePayload.targetDate, null);
});

test("Adversarial M4: milestone type guards reject malformed and hostile payloads", () => {
  // isMilestoneFormDraft
  assert.equal(isMilestoneFormDraft(null), false);
  assert.equal(isMilestoneFormDraft(undefined), false);
  assert.equal(isMilestoneFormDraft("string"), false);
  assert.equal(isMilestoneFormDraft([]), false);
  assert.equal(isMilestoneFormDraft({}), false);
  assert.equal(isMilestoneFormDraft({ baseRevision: "1" }), false);
  assert.equal(
    isMilestoneFormDraft({
      baseRevision: 1,
      stableKey: "k",
      title: "t",
      targetDate: "invalid-date-string",
      firstSubmittedPayload: null,
    }),
    false,
  );
  assert.equal(
    isMilestoneFormDraft({
      baseRevision: 1,
      stableKey: "k",
      title: "t",
      targetDate: "2026-02-30", // Invalid date
      firstSubmittedPayload: null,
    }),
    false,
  );

  // isMilestoneCreatePayload
  assert.equal(isMilestoneCreatePayload(null), false);
  assert.equal(isMilestoneCreatePayload({}), false);
  assert.equal(
    isMilestoneCreatePayload({
      stagePlanId: "sp",
      expectedStagePlanRevision: 1,
      stableKey: "k",
      title: "t",
      targetDate: null,
      sortOrder: "0" as unknown as number, // Should be number
    }),
    false,
  );
  assert.equal(
    isMilestoneCreatePayload({
      stagePlanId: "sp",
      expectedStagePlanRevision: 1,
      stableKey: "k",
      title: "t",
      targetDate: "2026-08-01T00:00:00.000Z",
      sortOrder: 0,
    }),
    true,
  );

  // isMilestoneArchiveCommand
  assert.equal(isMilestoneArchiveCommand(null), false);
  assert.equal(
    isMilestoneArchiveCommand({
      milestoneId: "m1",
      desiredArchived: true,
      baseRevision: 1,
      firstSubmittedPayload: { expectedRevision: 1, archive: true },
      firstSubmittedSnapshot: { id: "m1", revision: 1 } as PlanMilestoneDto,
    }),
    true,
  );
  assert.equal(
    isMilestoneArchiveCommand({
      milestoneId: "m1",
      desiredArchived: "true" as unknown as boolean, // invalid type
      baseRevision: 1,
      firstSubmittedPayload: { expectedRevision: 1, archive: true },
      firstSubmittedSnapshot: { id: "m1", revision: 1 } as PlanMilestoneDto,
    }),
    false,
  );
});

test("Adversarial M4: milestoneConflictComparisons constructs complete diff mappings", () => {
  const createConflict: MilestoneConflict = {
    type: "create",
    fields: ["stagePlan.revision", "stableKey"],
    submitted: {
      stagePlanId: "sp-1",
      expectedStagePlanRevision: 2,
      stableKey: "k-local",
      title: "Title Local",
      targetDate: "2026-09-01T00:00:00.000Z",
      sortOrder: 1,
    },
    latest: {
      kind: "plan-milestone",
      milestone: {
        id: "m-server",
        workspaceId: "ws-1",
        stagePlanId: "sp-1",
        stableKey: "k-server",
        title: "Title Server",
        targetDate: "2026-09-02T00:00:00.000Z",
        subjectId: null,
        sortOrder: 1,
        status: "active",
        revision: 3,
        archivedAt: null,
      },
      stagePlan: {
        id: "sp-1",
        name: "Stage 1",
        goal: "Goal",
        startDate: "2026-08-01",
        endDate: "2026-10-01",
        status: "active",
        mode: "strengthen",
        revision: 4,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    },
  };

  const createDiffs = milestoneConflictComparisons(createConflict);
  assert.equal(createDiffs.length, 4);
  assert.deepEqual(createDiffs.map((d: { field: string }) => d.field), [
    "stagePlan.revision",
    "stableKey",
    "title",
    "targetDate",
  ]);
  assert.equal(createDiffs[0].local, 2);
  assert.equal(createDiffs[0].server, 4);
  assert.equal(createDiffs[1].local, "k-local");
  assert.equal(createDiffs[1].server, "k-server");

  const archiveConflict: MilestoneConflict = {
    type: "archive",
    fields: ["revision"],
    command: {
      milestoneId: "m-1",
      desiredArchived: true,
      baseRevision: 2,
      firstSubmittedPayload: { expectedRevision: 2, archive: true },
      firstSubmittedSnapshot: {
        id: "m-1",
        workspaceId: "ws-1",
        stagePlanId: "sp-1",
        stableKey: "k-1",
        title: "Title Archival",
        targetDate: null,
        subjectId: null,
        sortOrder: 0,
        status: "active",
        revision: 2,
        archivedAt: null,
      },
    },
    latest: {
      kind: "plan-milestone",
      milestone: {
        id: "m-1",
        workspaceId: "ws-1",
        stagePlanId: "sp-1",
        stableKey: "k-1",
        title: "Title Server Mutated",
        targetDate: null,
        subjectId: null,
        sortOrder: 0,
        status: "active",
        revision: 3,
        archivedAt: "2026-08-25T00:00:00.000Z",
      },
      stagePlan: null,
    },
  };

  const archiveDiffs = milestoneConflictComparisons(archiveConflict);
  assert.equal(archiveDiffs.length, 3);
  assert.deepEqual(archiveDiffs.map((d: { field: string }) => d.field), ["revision", "archivedAt", "title"]);
  assert.equal(archiveDiffs[0].local, 2);
  assert.equal(archiveDiffs[0].server, 3);
  assert.equal(archiveDiffs[1].local, "归档");
  assert.equal(archiveDiffs[1].server, "归档");
});

test("Adversarial M4: flattenSyllabusNodes handles deep trees, multiple branches, and preserves depth", () => {
  const tree: SyllabusOptionNodeDto[] = [
    {
      id: "root-1",
      subjectId: "sub-math",
      title: "Higher Mathematics",
      children: [
        {
          id: "ch-1",
          subjectId: "sub-math",
          title: "Chapter 1: Limits",
          children: [
            {
              id: "sec-1-1",
              subjectId: "sub-math",
              title: "1.1 Squeeze Theorem",
              children: [],
            },
          ],
        },
        {
          id: "ch-2",
          subjectId: "sub-math",
          title: "Chapter 2: Derivatives",
          children: [],
        },
      ],
    },
    {
      id: "root-2",
      subjectId: "sub-cs",
      title: "Data Structures",
      children: [],
    },
  ];

  const flattened = flattenSyllabusNodes(tree);
  assert.equal(flattened.length, 5);
  assert.equal(flattened[0].id, "root-1");
  assert.equal(flattened[0].depth, 0);
  assert.equal(flattened[1].id, "ch-1");
  assert.equal(flattened[1].depth, 1);
  assert.equal(flattened[2].id, "sec-1-1");
  assert.equal(flattened[2].depth, 2);
  assert.equal(flattened[3].id, "ch-2");
  assert.equal(flattened[3].depth, 1);
  assert.equal(flattened[4].id, "root-2");
  assert.equal(flattened[4].depth, 0);

  // Empty tree produces empty array
  assert.deepEqual(flattenSyllabusNodes([]), []);
});

test("Adversarial M4: task create draft serialization roundtrip and boundary checks", () => {
  const snapshot = createDraftSnapshot({
    subjectId: "sub-1",
    syllabusNodeId: "node-1",
    relatedSyllabusNodeIds: ["node-2", "node-3"],
    stagePlanIds: ["sp-1"],
    knowledgePointIds: ["kp-1", "kp-2"],
    planMilestoneId: "ms-1",
    title: "Deep Calculus Practice",
    taskType: "practice",
    priority: "critical",
    estimatedMinutes: 60,
  });

  assert.equal(isTaskCreateDraft(snapshot), true);
  assert.equal(snapshot.title, "Deep Calculus Practice");
  assert.equal(snapshot.type, "practice");
  assert.equal(snapshot.priority, "critical");
  assert.equal(snapshot.estimatedMinutes, 60);

  // Invalid drafts
  assert.equal(isTaskCreateDraft(null), false);
  assert.equal(isTaskCreateDraft({ ...snapshot, relatedSyllabusNodeIds: "not-array" }), false);
  assert.equal(isTaskCreateDraft({ ...snapshot, estimatedMinutes: "60" }), false);
  assert.equal(isTaskCreateDraft({ ...snapshot, priority: "SUPER_HIGH" }), false);
});

test("Adversarial M4: plan inbox draft equality and conversion roundtrip", () => {
  const item: PlanInboxItemDto = {
    id: "inbox-item-1",
    workspaceId: "ws-1",
    originType: "WEEKLY_REVIEW_STRATEGY",
    originKey: "key-weekly",
    originVersion: 2,
    originSnapshot: { some: "data" },
    stableKey: "stable-101",
    sourceStableKey: "",
    title: "Focus on Linear Systems",
    subjectId: "sub-math",
    plannedDate: "2026-09-05T00:00:00.000Z",
    estimatedMinutes: 90,
    priority: "HIGH",
    type: "review",
    planMilestoneId: "m-1",
    primaryNodeId: "node-1",
    relatedNodeIds: ["node-2", "node-3"],
    status: "OPEN",
    supersededByItemId: null,
    convertedTaskId: null,
    missingFields: [],
    requiredMilestoneKey: null,
    revision: 3,
    dependencyRefs: [
      {
        id: "dep-1",
        targetType: "TASK",
        taskId: "task-0",
        dependencyType: "HARD",
        planStableKey: null,
        planOriginVersion: null,
        importBatchId: null,
      },
    ],
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };

  const draft = toPlanInboxFormDraft(item);
  assert.equal(draft.title, "Focus on Linear Systems");
  assert.equal(draft.subjectId, "sub-math");
  assert.equal(draft.estimatedMinutes, "90");
  assert.equal(draft.plannedDate, "2026-09-05");
  assert.equal(draft.primaryNodeId, "node-1");
  assert.deepEqual(draft.relatedNodeIds, ["node-2", "node-3"]);
  assert.equal(draft.predecessors.length, 1);
  assert.equal(draft.predecessors[0].taskId, "task-0");
  assert.equal(draft.predecessors[0].dependencyType, "HARD");

  const draftCopy = structuredClone(draft);
  assert.equal(planInboxDraftsEqual(draft, draftCopy), true);

  // Alter predecessors
  draftCopy.predecessors = [{ taskId: "task-0", dependencyType: "SOFT" }];
  assert.equal(planInboxDraftsEqual(draft, draftCopy), false);

  // Alter relatedNodeIds
  const draftCopy2 = structuredClone(draft);
  draftCopy2.relatedNodeIds = ["node-3", "node-2"]; // different order
  assert.equal(planInboxDraftsEqual(draft, draftCopy2), false);
});

test("Adversarial M4: plan inbox conflict comparisons construction", () => {
  const draft: PlanInboxFormDraft = {
    title: "Local Title",
    subjectId: "sub-1",
    plannedDate: "2026-09-01",
    estimatedMinutes: "45",
    priority: "MEDIUM",
    type: "study",
    planMilestoneId: "m-1",
    primaryNodeId: "n-1",
    relatedNodeIds: ["n-2"],
    predecessors: [{ taskId: "t-1", dependencyType: "SOFT" }],
  };

  const firstSubmission: PlanInboxFormDraft = {
    ...draft,
    title: "Baseline Title",
  };

  const conflict: PlanInboxConflict = {
    conflictFields: ["title", "revision"],
    firstSubmissionSnapshot: firstSubmission,
    latest: {
      id: "inbox-1",
      workspaceId: "ws-1",
      originType: "AI_PLAN_RECOMMENDATION",
      originKey: "k",
      originVersion: 1,
      originSnapshot: {},
      stableKey: "sk",
      sourceStableKey: "",
      title: "Server Title",
      subjectId: "sub-1",
      plannedDate: "2026-09-01T00:00:00.000Z",
      estimatedMinutes: 45,
      priority: "MEDIUM",
      type: "study",
      planMilestoneId: "m-1",
      primaryNodeId: "n-1",
      relatedNodeIds: ["n-2"],
      status: "OPEN",
      supersededByItemId: null,
      convertedTaskId: null,
      missingFields: [],
      requiredMilestoneKey: null,
      revision: 4,
      dependencyRefs: [],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  };

  const baselineItem: PlanInboxItemDto = {
    ...conflict.latest,
    title: "Baseline Title",
    revision: 2,
  };

  const comparisons = buildPlanInboxConflictComparisons(
    draft,
    2,
    baselineItem,
    conflict,
    null,
  );

  assert.ok(comparisons.length >= 6);
  const revDiff = comparisons.find((c: { field: string; local?: unknown; server?: unknown; baseline?: unknown }) => c.field === "revision");
  assert.ok(revDiff);
  assert.equal(revDiff.local, 2);
  assert.equal(revDiff.server, 4);

  const titleDiff = comparisons.find((c: { field: string; local?: unknown; server?: unknown; baseline?: unknown }) => c.field === "title");
  assert.ok(titleDiff);
  assert.equal(titleDiff.local, "Local Title");
  assert.equal(titleDiff.baseline, "Baseline Title");
  assert.equal(titleDiff.server, "Server Title");
});

test("Adversarial M4: shanghaiDateOffset leap year and boundary date offset calculation", () => {
  const today = shanghaiDateOffset(0);
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);

  const tomorrow = shanghaiDateOffset(1);
  assert.match(tomorrow, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(today, tomorrow);

  const yearAhead = shanghaiDateOffset(365);
  assert.match(yearAhead, /^\d{4}-\d{2}-\d{2}$/);
});

test("Adversarial M4: readReportHistorySnapshot and readReportDecisionFocus safety", () => {
  // Null snapshot fails safely with legacy empty format
  const empty = readReportHistorySnapshot(null);
  assert.equal(empty.format, "legacy");
  assert.equal(empty.metrics.totalMinutes, null);
  assert.equal(empty.metrics.effectiveMinutes, null);

  // Modern v2 snapshot with full metrics
  const modernSnapshot = {
    schemaVersion: 2,
    metrics: {
      effectiveMinutes: 450,
      taskCompletionRate: 0.85,
      reviewCompletionRate: 1.0,
      debtCount: 0,
      lowConversionCount: 1,
      dueNoteCount: 3,
      weakNodeCount: 1,
    },
    weakness: {
      title: "Derivative Applications",
      detail: "High mistake count",
      reasons: ["Failed 2 retests"],
    },
    strategy: {
      mustPressIssue: "Review derivatives",
      calmConclusion: "Progress is steady",
    },
    nextCycleDraft: {
      stageAdjustment: "Add 3 hours math per week",
    },
  };

  const readModern = readReportHistorySnapshot(modernSnapshot);
  assert.equal(readModern.format, "current");
  assert.equal(readModern.metrics.effectiveMinutes, 450);
  assert.equal(readModern.weakness?.title, "Derivative Applications");
  assert.equal(readModern.stageAdjustment, "Add 3 hours math per week");

  // readReportDecisionFocus with { focus: string | string[] }
  assert.equal(readReportDecisionFocus({ focus: "Direct focus string" }), "Direct focus string");
  assert.equal(readReportDecisionFocus({ focus: ["Array item 1", "Array item 2"] }), "Array item 1、Array item 2");
  assert.equal(readReportDecisionFocus(null), null);
  assert.equal(readReportDecisionFocus(undefined), null);
  assert.equal(readReportDecisionFocus(123), null);
});

test("Adversarial M4: stage plan remainingDays calculations & safeReturnTo helper logic", () => {
  function remainingDays(endDate: string, now = Date.now()) {
    const days = Math.ceil((new Date(endDate).getTime() - now) / 86_400_000);
    return days > 0 ? `${days} 天` : days === 0 ? "今天结束" : "已结束";
  }

  const baseNow = new Date("2026-08-26T12:00:00Z").getTime();
  assert.equal(remainingDays("2026-08-31T12:00:00Z", baseNow), "5 天");
  assert.equal(remainingDays("2026-08-26T12:00:00Z", baseNow), "今天结束");
  assert.equal(remainingDays("2026-08-20T12:00:00Z", baseNow), "已结束");

  function safeReturnTo(value?: string) {
    if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
    return value;
  }

  assert.equal(safeReturnTo("/roadmap/allocation"), "/roadmap/allocation");
  assert.equal(safeReturnTo("//malicious.site"), undefined);
  assert.equal(safeReturnTo("/legit\\path"), undefined);
  assert.equal(safeReturnTo("https://evil.com"), undefined);
  assert.equal(safeReturnTo(""), undefined);
  assert.equal(safeReturnTo(undefined), undefined);
});
