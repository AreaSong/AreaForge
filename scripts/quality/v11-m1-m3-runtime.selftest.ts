import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prisma } from "../../packages/db/src/index";
import {
  applyWorkspaceTakeover,
  createExamWorkspace,
  createWorkspaceSubject,
  previewWorkspaceTakeover,
} from "../../apps/web/lib/study/exam-workspace-service";
import { createPlanInboxItem, dismissPlanInboxItem } from "../../apps/web/lib/study/plan-inbox-service";
import { createPlanMilestone } from "../../apps/web/lib/study/plan-milestone-service";
import { createTaskDependency } from "../../apps/web/lib/study/task-dependency-service";
import { ApiError } from "../../apps/web/lib/api/responses";

const checks: Array<{ id: string; status: "pass"; details: Record<string, string | number | boolean> }> = [];

try {
  await assertIsolatedDatabase();
  await verifyPartialIndexes();
  await resetAndSeedLegacy();
  await verifySubjectLegacyCodeAndCustom();
  await verifyTakeoverAndRollback();
  await verifyDependencyCycle();
  await verifyPlanInboxOriginUniqueAndDismiss();

  console.log(
    JSON.stringify(
      {
        schemaVersion: "v11-m1-m3-runtime-selftest-v1",
        status: "pass",
        checks,
      },
      null,
      2,
    ),
  );
  console.log("PASS v11 M1-M3 isolated PostgreSQL runtime selftest");
} finally {
  await prisma.$disconnect();
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_V11_M1M3_ISOLATED_DB !== "1") {
    throw new Error("v11 M1-M3 runtime selftest requires AREAFORGE_V11_M1M3_ISOLATED_DB=1");
  }
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!rows[0]?.current_database.includes("v11m1m3")) {
    throw new Error("v11 M1-M3 runtime selftest refused a database without the isolated name marker");
  }
  pass("isolated_database", { database: rows[0].current_database });
}

async function verifyPartialIndexes(): Promise<void> {
  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'ExamWorkspace_one_active_per_user_idx',
        'Subject_legacyCode_uidx',
        'Subject_workspace_stableKey_uidx',
        'DailyReview_workspace_reviewDate_uidx',
        'CheckIn_workspace_studyDate_uidx',
        'PlanInboxItem_workspaceId_originKey_originVersion_key'
      )
  `;
  assert.equal(indexes.length, 6);
  pass("partial_and_unique_indexes", { count: indexes.length });
}

async function resetAndSeedLegacy(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "PlanInboxDependencyRef",
      "PlanInboxItem",
      "TaskDependency",
      "PlanMilestone",
      "StudyTaskRelatedSyllabusNode",
      "NoteRelatedSyllabusNode",
      "Attachment",
      "MasteryEvidence",
      "MasteryRetest",
      "MasteryConditionRecord",
      "Note",
      "Mistake",
      "StudySession",
      "TaskDebtEvent",
      "StudyTask",
      "SyllabusNode",
      "SimulationSubjectResult",
      "SimulationExam",
      "StageAdjustmentDraft",
      "StagePlan",
      "PeriodicReportDecision",
      "DailyReview",
      "CheckIn",
      "RecoveryState",
      "Subject",
      "SubjectGroup",
      "ExamWorkspace",
      "AuditEvent",
      "AuthSession",
      "User"
    RESTART IDENTITY CASCADE
  `);

  await prisma.user.create({
    data: {
      id: "user-a",
      email: "a@example.com",
      passwordHash: "x",
    },
  });
  await prisma.user.create({
    data: {
      id: "user-b",
      email: "b@example.com",
      passwordHash: "x",
    },
  });

  await prisma.subject.createMany({
    data: [
      {
        id: "subj-math",
        legacyCode: "MATH",
        stableKey: "math",
        name: "数学",
        color: "#38bdf8",
        sortOrder: 10,
      },
      {
        id: "subj-orphan",
        legacyCode: null,
        stableKey: "orphan-custom",
        name: "孤儿",
        color: "#999999",
        sortOrder: 99,
      },
    ],
  });

  await prisma.studyTask.create({
    data: {
      id: "task-1",
      subjectId: "subj-math",
      title: "极限",
      type: "study",
      plannedDate: new Date("2026-07-21T00:00:00.000Z"),
    },
  });
  await prisma.studyTask.create({
    data: {
      id: "task-2",
      subjectId: "subj-math",
      title: "导数",
      type: "study",
      plannedDate: new Date("2026-07-22T00:00:00.000Z"),
    },
  });
  await prisma.studyTask.create({
    data: {
      id: "task-3",
      subjectId: "subj-math",
      title: "积分",
      type: "study",
      plannedDate: new Date("2026-07-23T00:00:00.000Z"),
    },
  });

  pass("legacy_fixture_seeded", { subjects: 2, tasks: 3 });
}

async function verifySubjectLegacyCodeAndCustom(): Promise<void> {
  const workspace = await createExamWorkspace("user-a", {
    stableKey: "kaoyan-2027",
    name: "考研 2027",
    activate: true,
  });
  const custom = await createWorkspaceSubject("user-a", workspace.id, {
    stableKey: "custom-stats",
    name: "统计学",
    color: "#111111",
  });
  assert.equal(custom.legacyCode, null);
  assert.equal(custom.legacyScope, false);

  const legacy = await prisma.subject.findFirst({ where: { id: "subj-math" } });
  assert.equal(legacy?.legacyCode, "MATH");
  assert.equal(legacy?.workspaceId, null);
  pass("subject_legacy_and_custom", { workspaceId: workspace.id, customId: custom.id });
}

async function verifyTakeoverAndRollback(): Promise<void> {
  const workspace = await prisma.examWorkspace.findFirst({
    where: { userId: "user-a", status: "ACTIVE" },
  });
  assert.ok(workspace);

  const preview = await previewWorkspaceTakeover("user-a");
  assert.ok(preview.eligibleSubjectIds.includes("subj-math"));

  const applied = await applyWorkspaceTakeover("user-a", {
    workspaceId: workspace!.id,
    subjectIds: ["subj-math"],
    expectedRevision: workspace!.revision,
  });
  assert.deepEqual(applied.takenOverSubjectIds, ["subj-math"]);

  const taken = await prisma.subject.findFirst({ where: { id: "subj-math" } });
  assert.equal(taken?.workspaceId, workspace!.id);

  // rollback simulation: leave schema, restore subject to legacy null workspace in fixture only
  await prisma.subject.update({
    where: { id: "subj-math" },
    data: { workspaceId: null, groupId: null },
  });
  const restored = await prisma.subject.findFirst({ where: { id: "subj-math" } });
  assert.equal(restored?.workspaceId, null);

  // apply again after revision bump
  const refreshed = await prisma.examWorkspace.findFirst({ where: { id: workspace!.id } });
  await applyWorkspaceTakeover("user-a", {
    workspaceId: workspace!.id,
    subjectIds: ["subj-math"],
    expectedRevision: refreshed!.revision,
  });

  pass("takeover_apply_and_fixture_rollback", {
    eligible: preview.eligibleCount,
    unresolved: preview.unresolvedCount,
  });
}

async function verifyDependencyCycle(): Promise<void> {
  await createTaskDependency("user-a", {
    predecessorId: "task-1",
    successorId: "task-2",
    type: "SOFT",
  });
  await createTaskDependency("user-a", {
    predecessorId: "task-2",
    successorId: "task-3",
    type: "HARD",
  });

  let cycleBlocked = false;
  try {
    await createTaskDependency("user-a", {
      predecessorId: "task-3",
      successorId: "task-1",
      type: "SOFT",
    });
  } catch (error) {
    cycleBlocked = error instanceof ApiError && error.code === "DEPENDENCY_CYCLE";
  }
  assert.equal(cycleBlocked, true);

  let selfLoopBlocked = false;
  try {
    await createTaskDependency("user-a", {
      predecessorId: "task-1",
      successorId: "task-1",
      type: "SOFT",
    });
  } catch (error) {
    selfLoopBlocked = error instanceof ApiError && error.code === "DEPENDENCY_SELF_LOOP";
  }
  assert.equal(selfLoopBlocked, true);

  pass("dependency_cycle_and_self_loop", { cycleBlocked, selfLoopBlocked });
}

async function verifyPlanInboxOriginUniqueAndDismiss(): Promise<void> {
  const workspace = await prisma.examWorkspace.findFirst({
    where: { userId: "user-a", status: "ACTIVE" },
  });
  assert.ok(workspace);

  const stagePlan = await prisma.stagePlan.create({
    data: {
      workspaceId: workspace!.id,
      name: "冲刺",
      goal: "完成基础",
      mode: "normal",
      status: "active",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-09-01T00:00:00.000Z"),
    },
  });

  await createPlanMilestone("user-a", {
    stagePlanId: stagePlan.id,
    stableKey: "m1",
    title: "里程碑 1",
  });

  const item = await createPlanInboxItem("user-a", {
    stableKey: "inbox-1",
    originKey: "daily-review:2026-07-21",
    originVersion: 1,
    originType: "DAILY_REVIEW",
    originSnapshot: { source: "selftest" },
    title: "明日最低行动",
  });

  let originConflict = false;
  try {
    await createPlanInboxItem("user-a", {
      stableKey: "inbox-2",
      originKey: "daily-review:2026-07-21",
      originVersion: 1,
      originType: "DAILY_REVIEW",
      originSnapshot: { source: "selftest-dup" },
      title: "重复",
    });
  } catch (error) {
    originConflict = error instanceof ApiError && error.code === "PLAN_INBOX_ORIGIN_CONFLICT";
  }
  assert.equal(originConflict, true);

  const dismissed = await dismissPlanInboxItem("user-a", item.id, item.revision);
  assert.equal(dismissed.status, "DISMISSED");

  pass("plan_inbox_origin_and_dismiss", {
    itemId: item.id,
    originConflict,
  });
}

function pass(id: string, details: Record<string, string | number | boolean>): void {
  checks.push({ id, status: "pass", details });
}

// keep hash helper referenced for future fingerprinting hooks
void createHash;
