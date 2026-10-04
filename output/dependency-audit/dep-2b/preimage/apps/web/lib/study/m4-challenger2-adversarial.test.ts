import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { readReportHistorySnapshot, readReportDecisionFocus } from "@/lib/study/report-history-snapshot";
import type {
  PlanInboxItemDto,
  PlanMilestoneDto,
  StagePlanDto,
  SyllabusOptionNodeDto,
} from "@/lib/contracts";

function loadWebSource(relPath: string): string {
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
  throw new Error(`Could not find source file: ${relPath}`);
}

// ============================================================================
// SUITE 1: AST Boundary & Zero UI Debt Verification across M4 surfaces
// ============================================================================

test("Challenger 2 - AST Primitive Boundary & Line Budget in M4 Components", () => {
  const m4Files = [
    "app/(app)/roadmap/page.tsx",
    "lib/routes/plan-stages-page.tsx",
    "components/stage-milestone-manager.tsx",
    "components/stage-milestone-utils.ts",
    "lib/routes/plan-stages-analytics-page.tsx",
    "lib/routes/plan-page.tsx",
    "components/plan-rolling-day-list.tsx",
    "components/plan-rolling-client.tsx",
    "components/plan-rolling-create-drawer.tsx",
    "lib/routes/plan-inbox-page.tsx",
    "components/plan-inbox-client.tsx",
    "components/plan-inbox-item-view.tsx",
    "components/task-detail-client.tsx",
    "lib/routes/review-reports-page.tsx",
    "components/daily-review-facts.tsx",
    "components/review-form.tsx",
    "lib/routes/report-history-page.tsx",
  ];

  for (const relPath of m4Files) {
    const source = loadWebSource(relPath);
    const lineCount = source.split("\n").length;

    // 1. Strict File Line Budget (<= 500 lines)
    assert.ok(
      lineCount <= 500,
      `File ${relPath} exceeds 500 line limit (${lineCount} lines)!`,
    );

    // 2. Prohibit unstyled raw <button> tags
    const rawButtons = source.match(/<button[\s>]/g) || [];
    assert.equal(
      rawButtons.length,
      0,
      `Violation in ${relPath}: found ${rawButtons.length} raw <button> elements! Must use <Button> or <ButtonLink>`,
    );

    // 3. Prohibit unstyled raw <input> tags
    const rawInputs = source.match(/<input[\s>]/g) || [];
    assert.equal(
      rawInputs.length,
      0,
      `Violation in ${relPath}: found ${rawInputs.length} raw <input> elements! Must use <Input>`,
    );

    // 4. Prohibit unstyled raw <textarea> tags
    const rawTextareas = source.match(/<textarea[\s>]/g) || [];
    assert.equal(
      rawTextareas.length,
      0,
      `Violation in ${relPath}: found ${rawTextareas.length} raw <textarea> elements! Must use <Textarea>`,
    );

    // 5. Prohibit unstyled raw <select> tags
    const rawSelects = source.match(/<select[\s>]/g) || [];
    assert.equal(
      rawSelects.length,
      0,
      `Violation in ${relPath}: found ${rawSelects.length} raw <select> elements! Must use <Select>`,
    );

    // 6. Prohibit legacy background colors like bg-[#0d1117] in favor of dark glass tokens
    assert.doesNotMatch(
      source,
      /bg-\[#0d1117\]/,
      `Violation in ${relPath}: contains legacy bg-[#0d1117] color!`,
    );
  }
});

// ============================================================================
// SUITE 2: Viewport Ergonomics & Responsive Multi-Column Layouts
// ============================================================================

test("Challenger 2 - Layout Ergonomics: Eliminating 1500px stretched single rows", () => {
  // 1. Roadmap overview page: 2-column grid
  const overviewSource = loadWebSource("app/(app)/roadmap/page.tsx");
  assert.match(overviewSource, /grid-cols-1 md:grid-cols-2 gap-4/);

  // 2. Stage milestones: 2-column grid
  const milestoneSource = loadWebSource("components/stage-milestone-manager.tsx");
  assert.match(milestoneSource, /grid-cols-1 md:grid-cols-2 gap-3/);

  // 3. Stage analytics: 4-col fact cards + responsive 2-column layout for subjects/risks
  const stageAnalyticsSource = loadWebSource("lib/routes/plan-stages-analytics-page.tsx");
  assert.match(stageAnalyticsSource, /grid-cols-2 lg:grid-cols-4 gap-3/);
  assert.match(stageAnalyticsSource, /grid-cols-1 lg:grid-cols-\[1fr_360px\] gap-6/);

  // 4. Plan inbox list: 2-column draft cards
  const inboxClientSource = loadWebSource("components/plan-inbox-client.tsx");
  assert.match(inboxClientSource, /grid-cols-1 md:grid-cols-2 gap-4/);

  // 5. Periodic reviews: 6-metric grid + 2/3 column layout
  const reviewReportsSource = loadWebSource("lib/routes/review-reports-page.tsx");
  assert.match(reviewReportsSource, /grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3/);
  assert.match(reviewReportsSource, /grid-cols-1 lg:grid-cols-3 gap-6/);

  // 6. Daily review facts: 4-metric tile grid
  const dailyFactsSource = loadWebSource("components/daily-review-facts.tsx");
  assert.match(dailyFactsSource, /grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3/);
});

// ============================================================================
// SUITE 3: Pinned Action Bar & Editor Action Bar Docking Contracts
// ============================================================================

test("Challenger 2 - Sticky & Pinned Action Bar Contracts", () => {
  // Plan inbox item view uses PinnedActionBar with sticky mode
  const inboxItemSource = loadWebSource("components/plan-inbox-item-view.tsx");
  assert.match(inboxItemSource, /<PinnedActionBar[\s\S]*mode="sticky"/);

  // Review form uses EditorActionBar for submit actions
  const reviewFormSource = loadWebSource("components/review-form.tsx");
  assert.match(reviewFormSource, /<EditorActionBar[\s\S]*primaryType="submit"/);
});

// ============================================================================
// SUITE 4: Stage Milestone Utils & State Machine Stress Testing
// ============================================================================

test("Challenger 2 - Stage Milestone: Key increments and collision handling", () => {
  // Test empty milestones
  assert.equal(nextMilestoneKey([]), "milestone-1");

  // Test non-numeric stableKeys: length is 2, first candidate is milestone-3 (which is unused)
  const nonNumericMilestones: PlanMilestoneDto[] = [
    {
      id: "m1",
      workspaceId: "w1",
      stagePlanId: "s1",
      stableKey: "custom-alpha",
      title: "Alpha",
      targetDate: null,
      subjectId: null,
      sortOrder: 0,
      status: "active",
      revision: 1,
      archivedAt: null,
    },
    {
      id: "m2",
      workspaceId: "w1",
      stagePlanId: "s1",
      stableKey: "milestone-5",
      title: "Five",
      targetDate: null,
      subjectId: null,
      sortOrder: 1,
      status: "active",
      revision: 1,
      archivedAt: null,
    },
  ];
  assert.equal(nextMilestoneKey(nonNumericMilestones), "milestone-3");

  // When milestone-1 through milestone-3 exist
  const existingMilestones: PlanMilestoneDto[] = [
    { ...nonNumericMilestones[0], stableKey: "milestone-1" },
    { ...nonNumericMilestones[1], stableKey: "milestone-2" },
  ];
  assert.equal(nextMilestoneKey(existingMilestones), "milestone-3");
});

test("Challenger 2 - Stage Milestone: Conflict Comparisons generation", () => {
  const plan: StagePlanDto = {
    id: "sp-1",
    name: "2027 Math Sprint",
    goal: "High score",
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: "2026-12-01T00:00:00.000Z",
    status: "active",
    revision: 5,
    mode: "strengthen",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  const createConflict: MilestoneConflict = {
    type: "create",
    latest: { kind: "plan-milestone", milestone: null, stagePlan: plan },
    fields: ["stagePlan.revision"],
    submitted: {
      stagePlanId: "sp-1",
      expectedStagePlanRevision: 4,
      stableKey: "milestone-1",
      title: "Calculus",
      targetDate: "2026-10-01T00:00:00.000Z",
      sortOrder: 0,
    },
  };

  const comps = milestoneConflictComparisons(createConflict);
  assert.equal(comps.length, 4);
  const revComp = comps.find((c: { field: string }) => c.field === "stagePlan.revision");
  assert.ok(revComp);
  assert.equal(revComp.local, 4);
  assert.equal(revComp.server, 5);
});

// ============================================================================
// SUITE 5: 7-Day Rolling Plan & Syllabus Flattener Stress Testing
// ============================================================================

test("Challenger 2 - Syllabus Tree Recursive Flattening with Extreme Depth", () => {
  const nestedTree: SyllabusOptionNodeDto[] = [
    {
      id: "root-1",
      subjectId: "sub-math",
      title: "高等数学",
      children: [
        {
          id: "ch-1",
          subjectId: "sub-math",
          title: "极限与连续",
          children: [
            {
              id: "ch-1-1",
              subjectId: "sub-math",
              title: "洛必达法则",
              children: [],
            },
          ],
        },
      ],
    },
    {
      id: "root-2",
      subjectId: "sub-eng",
      title: "英语一",
      children: [],
    },
  ];

  const flattened = flattenSyllabusNodes(nestedTree);
  assert.equal(flattened.length, 4);
  assert.equal(flattened[0].id, "root-1");
  assert.equal(flattened[0].depth, 0);
  assert.equal(flattened[1].id, "ch-1");
  assert.equal(flattened[1].depth, 1);
  assert.equal(flattened[2].id, "ch-1-1");
  assert.equal(flattened[2].depth, 2);
  assert.equal(flattened[3].id, "root-2");
  assert.equal(flattened[3].depth, 0);
});

test("Challenger 2 - Task Create Draft Snapshot Validation", () => {
  const validDraft = createDraftSnapshot({
    subjectId: "sub-1",
    syllabusNodeId: "node-1",
    relatedSyllabusNodeIds: ["node-2"],
    stagePlanIds: ["stage-1"],
    knowledgePointIds: ["kp-1"],
    planMilestoneId: "m-1",
    title: "Deep Study",
    taskType: "study",
    priority: "high",
    estimatedMinutes: 50,
  });

  assert.equal(isTaskCreateDraft(validDraft), true);
  assert.equal(isTaskCreateDraft(null), false);
  assert.equal(isTaskCreateDraft({ ...validDraft, estimatedMinutes: "not-a-number" }), false);
  assert.equal(isTaskCreateDraft({ ...validDraft, relatedSyllabusNodeIds: "not-an-array" }), false);
});

// ============================================================================
// SUITE 6: Plan Inbox Conversion & Conflict Matrix Stress Testing
// ============================================================================

test("Challenger 2 - Plan Inbox Item: Conversion Comparisons and Statuses", () => {
  const item: PlanInboxItemDto = {
    id: "inbox-item-1",
    workspaceId: "ws-1",
    originType: "DAILY_REVIEW_MINIMUM",
    originKey: "daily-rev-1",
    originVersion: 1,
    originSnapshot: { some: "data" },
    stableKey: "stable-rev-1",
    sourceStableKey: "source-1",
    title: "明日最低行动",
    subjectId: "sub-math",
    plannedDate: "2026-08-27T00:00:00.000Z",
    estimatedMinutes: 30,
    priority: "HIGH",
    type: "study",
    planMilestoneId: "m-1",
    primaryNodeId: "node-1",
    relatedNodeIds: [],
    status: "OPEN",
    supersededByItemId: null,
    convertedTaskId: null,
    missingFields: [],
    requiredMilestoneKey: null,
    revision: 2,
    dependencyRefs: [],
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:00:00.000Z",
  };

  const draft = toPlanInboxFormDraft(item);
  const conflict = {
    submitted: item,
    latest: { ...item, revision: 3, title: "Server Updated Title" },
    conflictFields: ["title", "revision"],
    firstSubmissionSnapshot: null,
  };

  const comps = buildPlanInboxConflictComparisons(draft, 2, item, conflict, null);
  assert.ok(comps.length > 0);
  const titleComp = comps.find((c: { field: string }) => c.field === "title");
  assert.ok(titleComp);
  assert.equal(titleComp.server, "Server Updated Title");

  // Verify Shanghai offset calculations
  const today = shanghaiDateOffset(0);
  const tomorrow = shanghaiDateOffset(1);
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(tomorrow, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(today, tomorrow);
});

// ============================================================================
// SUITE 7: Periodic Reports & Historical Snapshot Deserializer Resilience
// ============================================================================

test("Challenger 2 - Report History Snapshots: Legacy vs Current vs Corrupted", () => {
  // Case A: Current format snapshot
  const currentSnapshot = {
    metrics: {
      effectiveMinutes: 350,
      taskCompletionRate: 0.85,
      reviewCompletionRate: 1.0,
      debtCount: 1,
    },
    weakness: {
      title: "数学真题二刷偏慢",
      detail: "耗时超出预期，需强化公式推导",
      reasons: ["平均耗时 > 120min", "错题归因集中于计算失误"],
    },
    strategy: {
      mustPressIssue: "主攻线性代数特征值",
    },
    nextCycleDraft: {
      stageAdjustment: "延长强化阶段 7 天",
    },
  };
  const parsedCurrent = readReportHistorySnapshot(currentSnapshot);
  assert.equal(parsedCurrent.format, "current");
  assert.equal(parsedCurrent.metrics.effectiveMinutes, 350);
  assert.equal(parsedCurrent.weakness?.title, "数学真题二刷偏慢");

  // Case B: Legacy format snapshot (flat metrics without snapshot.metrics object)
  const legacySnapshot = {
    totalMinutes: 500,
    effectiveMinutes: 400,
    completionRate: 0.75,
    lowConversionCount: 2,
  };
  const parsedLegacy = readReportHistorySnapshot(legacySnapshot);
  assert.equal(parsedLegacy.format, "legacy");
  assert.equal(parsedLegacy.metrics.totalMinutes, 500);
  assert.equal(parsedLegacy.metrics.reviewCompletionRate, null);

  // Case C: Corrupted or null input
  const parsedNull = readReportHistorySnapshot(null);
  assert.equal(parsedNull.format, "legacy");
  assert.equal(parsedNull.metrics.effectiveMinutes, null);

  // Case D: Next cycle draft focus reader
  assert.equal(readReportDecisionFocus({ focus: "Focus English" }), "Focus English");
  assert.equal(readReportDecisionFocus({ focus: ["Math", "English"] }), "Math、English");
  assert.equal(readReportDecisionFocus(null), null);
});
