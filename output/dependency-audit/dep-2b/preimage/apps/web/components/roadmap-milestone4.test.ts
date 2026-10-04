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
} from "./stage-milestone-utils";
import { formatPlanDay, formatShortDate } from "./plan-rolling-day-list";
import {
  buildPlanInboxConflictComparisons,
  detailHref,
  getPlanInboxMissingFields,
  initialPlanInboxEditorFields,
  isPlanInboxEditorFieldVisible,
  planInboxDraftsEqual,
  planInboxStatusLabel,
  shanghaiDateOffset,
  toPlanInboxFormDraft,
} from "./plan-inbox-item-utils";
import type { PlanInboxItemDto, PlanMilestoneDto } from "@/lib/contracts";

test("stage milestone utils: formatPayload and createArchiveCommand work deterministically", () => {
  const draft = {
    baseRevision: 3,
    stableKey: "  milestone-core  ",
    title: "  Master Linear Algebra  ",
    targetDate: "2026-09-01",
    firstSubmittedPayload: null,
  };

  const payload = formPayload(draft, "stage-1", 1);
  assert.equal(payload.stagePlanId, "stage-1");
  assert.equal(payload.expectedStagePlanRevision, 3);
  assert.equal(payload.stableKey, "milestone-core");
  assert.equal(payload.title, "Master Linear Algebra");
  assert.equal(payload.targetDate, "2026-08-31T16:00:00.000Z");
  assert.equal(payload.sortOrder, 1);

  const row: PlanMilestoneDto = {
    id: "m-1",
    workspaceId: "ws-1",
    stagePlanId: "stage-1",
    stableKey: "milestone-1",
    title: "Milestone 1",
    targetDate: "2026-09-01T00:00:00.000Z",
    subjectId: null,
    sortOrder: 0,
    status: "active",
    revision: 2,
    archivedAt: null,
  };

  const archiveCmd = createArchiveCommand(row, true);
  assert.equal(archiveCmd.milestoneId, "m-1");
  assert.equal(archiveCmd.desiredArchived, true);
  assert.equal(archiveCmd.baseRevision, 2);
  assert.equal(archiveCmd.firstSubmittedPayload.archive, true);
  assert.equal(archiveCmd.firstSubmittedPayload.expectedRevision, 2);
});

test("stage milestone utils: upsertMilestone and nextMilestoneKey", () => {
  const row1: PlanMilestoneDto = {
    id: "m-1",
    workspaceId: "ws-1",
    stagePlanId: "stage-1",
    stableKey: "milestone-1",
    title: "M1",
    targetDate: null,
    subjectId: null,
    sortOrder: 0,
    status: "active",
    revision: 1,
    archivedAt: null,
  };
  const row2: PlanMilestoneDto = {
    ...row1,
    id: "m-2",
    stableKey: "milestone-2",
    title: "M2",
  };

  const initial = [row1];
  const nextKey = nextMilestoneKey(initial);
  assert.equal(nextKey, "milestone-2");

  const updatedRow1 = { ...row1, title: "M1-Updated", revision: 2 };
  const replaced = upsertMilestone(initial, updatedRow1);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].title, "M1-Updated");

  const added = upsertMilestone(initial, row2);
  assert.equal(added.length, 2);
});

test("stage milestone utils: validators and error labelling", () => {
  assert.equal(labelMilestoneError("PLAN_MILESTONE_STABLE_KEY_CONFLICT"), "这个稳定键已存在，请处理冲突后修改。");
  assert.equal(labelMilestoneError("PLAN_MILESTONE_REVISION_CONFLICT"), "里程碑已被其他页面更新，请处理差异后重试。");
  assert.equal(labelMilestoneError("PLAN_MILESTONE_STAGE_PLAN_REVISION_CONFLICT"), "StagePlan 已更新，请基于最新阶段版本重新检查。");
  assert.equal(labelMilestoneError("UNKNOWN_ERROR"), "UNKNOWN_ERROR");

  assert.equal(isMilestoneFormDraft({ baseRevision: 1, stableKey: "k", title: "t", targetDate: "2026-09-01", firstSubmittedPayload: null }), true);
  assert.equal(isMilestoneFormDraft({ baseRevision: "1" }), false);

  assert.equal(isMilestoneCreatePayload({ stagePlanId: "s", expectedStagePlanRevision: 1, stableKey: "k", title: "t", targetDate: null, sortOrder: 0 }), true);
  assert.equal(isMilestoneCreatePayload(null), false);

  const payloadA = { stagePlanId: "s", expectedStagePlanRevision: 1, stableKey: "k", title: "t", targetDate: null, sortOrder: 0 };
  const payloadB = { ...payloadA };
  assert.equal(samePayload(payloadA, payloadB), true);
});

test("plan rolling date formatters: formatPlanDay and formatShortDate", () => {
  const formattedDay = formatPlanDay("2026-09-01");
  assert.ok(formattedDay.startsWith("09-01"));

  const short = formatShortDate("2026-09-01T12:00:00.000Z");
  assert.ok(short.includes("09"));
});

test("plan inbox item utils: toPlanInboxFormDraft and comparison", () => {
  const item: PlanInboxItemDto = {
    id: "inbox-1",
    workspaceId: "ws-1",
    originType: "AI_PLAN_RECOMMENDATION",
    originKey: "key-1",
    originVersion: 1,
    originSnapshot: {},
    stableKey: "stable-1",
    sourceStableKey: "source-1",
    title: "Study Calculus",
    subjectId: "sub-1",
    plannedDate: "2026-09-01T00:00:00.000Z",
    estimatedMinutes: 60,
    priority: "HIGH",
    type: "focus",
    planMilestoneId: null,
    primaryNodeId: null,
    relatedNodeIds: ["node-1"],
    status: "OPEN",
    supersededByItemId: null,
    convertedTaskId: null,
    missingFields: [],
    requiredMilestoneKey: null,
    revision: 1,
    dependencyRefs: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };

  const draft = toPlanInboxFormDraft(item);
  assert.equal(draft.title, "Study Calculus");
  assert.equal(draft.subjectId, "sub-1");
  assert.equal(draft.estimatedMinutes, "60");
  assert.equal(draft.priority, "HIGH");

  const equal = planInboxDraftsEqual(draft, toPlanInboxFormDraft(item));
  assert.equal(equal, true);

  const modified = { ...draft, title: "Different Title" };
  assert.equal(planInboxDraftsEqual(draft, modified), false);

  assert.equal(planInboxStatusLabel("OPEN"), "待安排");
  assert.equal(planInboxStatusLabel("CONVERTED"), "已转为任务");
  assert.equal(planInboxStatusLabel("DISMISSED"), "已忽略");

  assert.deepEqual(getPlanInboxMissingFields(draft, null), []);
  assert.equal(initialPlanInboxEditorFields(draft, null), null);
  assert.deepEqual(
    getPlanInboxMissingFields({ ...draft, subjectId: "", plannedDate: "", estimatedMinutes: "" }, null),
    [
      { key: "subjectId", label: "科目" },
      { key: "plannedDate", label: "日期" },
      { key: "estimatedMinutes", label: "预计时长" },
    ],
  );
  const missingOnly = initialPlanInboxEditorFields({ ...draft, subjectId: "", plannedDate: "" }, null);
  assert.deepEqual(missingOnly, ["subjectId", "plannedDate"]);
  assert.equal(isPlanInboxEditorFieldVisible(missingOnly, "subjectId"), true);
  assert.equal(isPlanInboxEditorFieldVisible(missingOnly, "title"), false);
  assert.equal(isPlanInboxEditorFieldVisible("all", "title"), true);
});
