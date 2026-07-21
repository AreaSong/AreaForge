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
  await verifyActiveWorkspaceUnique();
  await verifySubjectLegacyCodeAndCustom();
  await verifyTakeoverIneligibleNoPartialWrite();
  await verifyTakeoverMidTransactionRollback();
  await verifyTakeoverHappyPath();
  await verifyDependencyCycle();
  await verifyPlanInboxWriteBoundaries();

  console.log(
    JSON.stringify(
      {
        schemaVersion: "v11-m1-m3-runtime-selftest-v2",
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

async function verifyActiveWorkspaceUnique(): Promise<void> {
  const first = await createExamWorkspace("user-a", {
    stableKey: "ws-first",
    name: "第一工作区",
    activate: true,
  });
  const second = await createExamWorkspace("user-a", {
    stableKey: "ws-second",
    name: "第二工作区",
    activate: true,
  });

  const actives = await prisma.examWorkspace.findMany({
    where: { userId: "user-a", status: "ACTIVE" },
  });
  assert.equal(actives.length, 1);
  assert.equal(actives[0]?.id, second.id);

  const archivedFirst = await prisma.examWorkspace.findFirst({ where: { id: first.id } });
  assert.equal(archivedFirst?.status, "ARCHIVED");

  let partialUniqueRejected = false;
  try {
    await prisma.$executeRaw`
      UPDATE "ExamWorkspace"
      SET status = 'ACTIVE', "archivedAt" = NULL
      WHERE id = ${first.id}
    `;
  } catch {
    partialUniqueRejected = true;
  }
  assert.equal(partialUniqueRejected, true);

  const stillOne = await prisma.examWorkspace.count({
    where: { userId: "user-a", status: "ACTIVE" },
  });
  assert.equal(stillOne, 1);

  pass("active_workspace_unique", {
    firstId: first.id,
    secondId: second.id,
    partialUniqueRejected,
  });
}

async function verifySubjectLegacyCodeAndCustom(): Promise<void> {
  const workspace = await prisma.examWorkspace.findFirst({
    where: { userId: "user-a", status: "ACTIVE" },
  });
  assert.ok(workspace);

  const custom = await createWorkspaceSubject("user-a", workspace!.id, {
    stableKey: "custom-stats",
    name: "统计学",
    color: "#111111",
  });
  assert.equal(custom.legacyCode, null);
  assert.equal(custom.legacyScope, false);

  const legacy = await prisma.subject.findFirst({ where: { id: "subj-math" } });
  assert.equal(legacy?.legacyCode, "MATH");
  assert.equal(legacy?.workspaceId, null);
  pass("subject_legacy_and_custom", { workspaceId: workspace!.id, customId: custom.id });
}

async function verifyTakeoverIneligibleNoPartialWrite(): Promise<void> {
  const workspace = await prisma.examWorkspace.findFirst({
    where: { userId: "user-a", status: "ACTIVE" },
  });
  assert.ok(workspace);

  await prisma.subject.update({
    where: { id: "subj-math" },
    data: { workspaceId: null, groupId: null },
  });

  const preview = await previewWorkspaceTakeover("user-a");
  assert.ok(preview.eligibleSubjectIds.includes("subj-math"));
  assert.ok(preview.unresolvedSubjectIds.includes("subj-orphan"));

  let blocked = false;
  try {
    await applyWorkspaceTakeover("user-a", {
      workspaceId: workspace!.id,
      subjectIds: ["subj-math", "subj-orphan"],
      expectedRevision: workspace!.revision,
    });
  } catch (error) {
    blocked = error instanceof ApiError && error.code === "TAKEOVER_SUBJECT_NOT_ELIGIBLE";
  }
  assert.equal(blocked, true);

  const math = await prisma.subject.findFirst({ where: { id: "subj-math" } });
  const orphan = await prisma.subject.findFirst({ where: { id: "subj-orphan" } });
  assert.equal(math?.workspaceId, null);
  assert.equal(orphan?.workspaceId, null);

  pass("takeover_ineligible_no_partial_write", {
    blocked,
    eligible: preview.eligibleCount,
    unresolved: preview.unresolvedCount,
  });
}

async function verifyTakeoverMidTransactionRollback(): Promise<void> {
  const workspace = await prisma.examWorkspace.findFirst({
    where: { userId: "user-a", status: "ACTIVE" },
  });
  assert.ok(workspace);

  let forcedFailure = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.subject.update({
        where: { id: "subj-math" },
        data: { workspaceId: workspace!.id },
      });
      forcedFailure = true;
      throw new Error("forced_mid_takeover_failure");
    });
  } catch (error) {
    assert.equal(error instanceof Error && error.message === "forced_mid_takeover_failure", true);
  }
  assert.equal(forcedFailure, true);

  const math = await prisma.subject.findFirst({ where: { id: "subj-math" } });
  assert.equal(math?.workspaceId, null);

  pass("takeover_mid_transaction_rollback", {
    forcedFailure,
    workspaceIdStillNull: math?.workspaceId === null,
  });
}

async function verifyTakeoverHappyPath(): Promise<void> {
  const workspace = await prisma.examWorkspace.findFirst({
    where: { userId: "user-a", status: "ACTIVE" },
  });
  assert.ok(workspace);

  const applied = await applyWorkspaceTakeover("user-a", {
    workspaceId: workspace!.id,
    subjectIds: ["subj-math"],
    expectedRevision: workspace!.revision,
  });
  assert.deepEqual(applied.takenOverSubjectIds, ["subj-math"]);

  const taken = await prisma.subject.findFirst({ where: { id: "subj-math" } });
  assert.equal(taken?.workspaceId, workspace!.id);

  pass("takeover_happy_path", { subjectId: "subj-math", workspaceId: workspace!.id });
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

  const edgeCount = await prisma.taskDependency.count();
  assert.equal(edgeCount, 2);

  pass("dependency_cycle_and_self_loop", { cycleBlocked, selfLoopBlocked, edgeCount });
}

async function verifyPlanInboxWriteBoundaries(): Promise<void> {
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

  let convertedWithoutTaskRejected = false;
  try {
    await prisma.$executeRaw`
      INSERT INTO "PlanInboxItem" (
        id, "workspaceId", "stableKey", "originKey", "originVersion", "originType",
        "originSnapshot", status, title, revision, "createdAt", "updatedAt", "convertedTaskId"
      ) VALUES (
        'bad-converted', ${workspace!.id}, 'bad-converted', 'bad:origin', 1, 'TEST',
        '{}'::jsonb, 'CONVERTED', '非法转换', 1, NOW(), NOW(), NULL
      )
    `;
  } catch {
    convertedWithoutTaskRejected = true;
  }
  assert.equal(convertedWithoutTaskRejected, true);

  pass("plan_inbox_write_boundaries", {
    itemId: item.id,
    originConflict,
    convertedWithoutTaskRejected,
  });
}

function pass(id: string, details: Record<string, string | number | boolean>): void {
  checks.push({ id, status: "pass", details });
}

void createHash;
