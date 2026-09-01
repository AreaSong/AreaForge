import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../packages/db/src/index";
import {
  applyWorkspaceTakeover,
  activateExamWorkspace,
  createExamWorkspace,
  createSubjectGroup,
  createWorkspaceSubject,
  previewWorkspaceTakeover,
  updateSubjectGroup,
  updateWorkspaceSubject,
} from "../../apps/web/lib/study/exam-workspace-service";
import {
  convertPlanInboxItem,
  createPlanInboxItem,
  dismissPlanInboxItem,
  updatePlanInboxItem,
} from "../../apps/web/lib/study/plan-inbox-service";
import { createPlanMilestone, updatePlanMilestone } from "../../apps/web/lib/study/plan-milestone-service";
import { startRecoveryV2 } from "../../apps/web/lib/study/recovery-v2-service";
import { createStudyTask } from "../../apps/web/lib/study/task-command-service";
import { createTaskDependency } from "../../apps/web/lib/study/task-dependency-service";
import { ApiError } from "../../apps/web/lib/api/responses";

const checks: Array<{ id: string; status: "pass"; details: Record<string, string | number | boolean> }> = [];

try {
  await assertIsolatedDatabase();
  await verifyPartialIndexes();
  await resetAndSeedLegacy();
  await verifyActiveWorkspaceUnique();
  await verifyAtomicWorkspaceSetupAndRevisionWrites();
  await verifySubjectArchiveBoundaries();
  await verifyWorkspaceRecoverySwitchRace();
  await verifySubjectLegacyCodeAndCustom();
  await verifyTakeoverIneligibleNoPartialWrite();
  await verifyTakeoverMidTransactionRollback();
  await verifyTakeoverHappyPath();
  await verifyAtomicFirstUseSetupTakeover();
  await verifyDependencyCycle();
  await verifyPlanInboxWriteBoundaries();

  console.log(
    JSON.stringify(
      {
        schemaVersion: "v11-m1-m3-runtime-selftest-v3",
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
    subjects: [{ stableKey: "first-subject", name: "第一科目", color: "#2563eb" }],
  });
  const second = await createExamWorkspace("user-a", {
    stableKey: "ws-second",
    name: "第二工作区",
    activate: true,
    subjects: [{ stableKey: "second-subject", name: "第二科目", color: "#16a34a" }],
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

async function verifyAtomicWorkspaceSetupAndRevisionWrites(): Promise<void> {
  const original = await createExamWorkspace("user-b", {
    stableKey: "ws-original",
    name: "原工作区",
    activate: true,
    subjects: [{ stableKey: "original-subject", name: "原科目", color: "#2563eb" }],
  });

  let atomicRollback = false;
  try {
    await createExamWorkspace("user-b", {
      stableKey: "ws-invalid",
      name: "不应落库",
      activate: true,
      subjects: [
        { stableKey: "duplicate", name: "重复一", color: "#111111" },
        { stableKey: "duplicate", name: "重复二", color: "#222222" },
      ],
    });
  } catch (error) {
    atomicRollback = error instanceof ApiError && error.code === "SUBJECT_STABLE_KEY_DUPLICATE";
  }
  assert.equal(atomicRollback, true);
  assert.equal(await prisma.examWorkspace.count({ where: { userId: "user-b" } }), 1);
  assert.equal((await prisma.examWorkspace.findUniqueOrThrow({ where: { id: original.id } })).status, "ACTIVE");

  const created = await createExamWorkspace("user-b", {
    stableKey: "ws-atomic",
    name: "原子工作区",
    activate: true,
    subjects: [
      { stableKey: "math", name: "数学", color: "#35d7c5", sortOrder: 10 },
      { stableKey: "408-data", name: "数据结构", color: "#22c55e", sortOrder: 20, groupStableKey: "408" },
    ],
  });
  const initialRows = await prisma.subject.findMany({ where: { workspaceId: created.id }, orderBy: { sortOrder: "asc" } });
  const group408 = await prisma.subjectGroup.findFirstOrThrow({ where: { workspaceId: created.id, stableKey: "408" } });
  assert.equal(initialRows.length, 2);
  assert.equal(initialRows[1]?.groupId, group408.id);

  const customGroup = await createSubjectGroup("user-b", created.id, {
    expectedWorkspaceRevision: created.revision,
    stableKey: "public",
    name: "公共课",
    sortOrder: 10,
  });
  assert.equal(customGroup.workspace.revision, created.revision + 1);

  const subject = await createWorkspaceSubject("user-b", created.id, {
    expectedWorkspaceRevision: customGroup.workspace.revision,
    stableKey: "english",
    name: "英语",
    color: "#3b82f6",
    groupId: customGroup.group.id,
    sortOrder: 30,
  });
  const afterSubjectCreate = await prisma.examWorkspace.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(afterSubjectCreate.revision, customGroup.workspace.revision + 1);

  await assert.rejects(
    () => createWorkspaceSubject("user-b", created.id, {
      expectedWorkspaceRevision: afterSubjectCreate.revision,
      stableKey: "english",
      name: "重复英语",
      color: "#ef4444",
    }),
    (error: unknown) => error instanceof ApiError
      && error.code === "SUBJECT_STABLE_KEY_ALREADY_EXISTS"
      && error.status === 409,
  );
  await assert.rejects(
    () => createSubjectGroup("user-b", created.id, {
      expectedWorkspaceRevision: afterSubjectCreate.revision,
      stableKey: "public",
      name: "重复公共课",
    }),
    (error: unknown) => error instanceof ApiError
      && error.code === "SUBJECT_GROUP_STABLE_KEY_ALREADY_EXISTS"
      && error.status === 409,
  );
  assert.equal(
    (await prisma.examWorkspace.findUniqueOrThrow({ where: { id: created.id } })).revision,
    afterSubjectCreate.revision,
  );

  const archivedGroupForCreate = await updateSubjectGroup("user-b", created.id, customGroup.group.id, {
    expectedWorkspaceRevision: afterSubjectCreate.revision,
    archived: true,
  });
  const subjectCountBeforeArchivedGroupWrite = await prisma.subject.count({ where: { workspaceId: created.id } });
  await assert.rejects(
    () => createWorkspaceSubject("user-b", created.id, {
      expectedWorkspaceRevision: archivedGroupForCreate.workspace.revision,
      stableKey: "archived-group-rejected",
      name: "不得加入归档分组",
      color: "#ef4444",
      groupId: customGroup.group.id,
    }),
    (error: unknown) => error instanceof ApiError
      && error.code === "SUBJECT_GROUP_NOT_FOUND"
      && error.status === 404,
  );
  assert.equal(await prisma.subject.count({ where: { workspaceId: created.id } }), subjectCountBeforeArchivedGroupWrite);
  assert.equal(
    (await prisma.examWorkspace.findUniqueOrThrow({ where: { id: created.id } })).revision,
    archivedGroupForCreate.workspace.revision,
  );
  const restoredGroupForCreate = await updateSubjectGroup("user-b", created.id, customGroup.group.id, {
    expectedWorkspaceRevision: archivedGroupForCreate.workspace.revision,
    archived: false,
  });

  let staleRevisionRejected = false;
  try {
    await updateWorkspaceSubject("user-b", created.id, subject.id, {
      expectedWorkspaceRevision: customGroup.workspace.revision,
      sortOrder: 5,
    });
  } catch (error) {
    staleRevisionRejected = error instanceof ApiError && error.code === "WORKSPACE_REVISION_CONFLICT";
  }
  assert.equal(staleRevisionRejected, true);

  const subjectMovedOnce = await updateWorkspaceSubject("user-b", created.id, subject.id, {
    expectedWorkspaceRevision: restoredGroupForCreate.workspace.revision,
    move: "UP",
  });
  assert.deepEqual(
    (await prisma.subject.findMany({
      where: { workspaceId: created.id, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { stableKey: true, sortOrder: true },
    })),
    [
      { stableKey: "math", sortOrder: 10 },
      { stableKey: "english", sortOrder: 20 },
      { stableKey: "408-data", sortOrder: 30 },
    ],
  );
  const subjectMovedTwice = await updateWorkspaceSubject("user-b", created.id, subject.id, {
    expectedWorkspaceRevision: subjectMovedOnce.workspace.revision,
    move: "UP",
  });
  assert.deepEqual(
    (await prisma.subject.findMany({
      where: { workspaceId: created.id, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { stableKey: true, sortOrder: true },
    })),
    [
      { stableKey: "english", sortOrder: 10 },
      { stableKey: "math", sortOrder: 20 },
      { stableKey: "408-data", sortOrder: 30 },
    ],
  );
  const subjectReorderAuditCount = await prisma.auditEvent.count({
    where: { actorId: "user-b", action: "SUBJECT_REORDERED", entityId: subject.id },
  });
  const subjectBoundaryNoop = await updateWorkspaceSubject("user-b", created.id, subject.id, {
    expectedWorkspaceRevision: subjectMovedTwice.workspace.revision,
    move: "UP",
  });
  assert.equal(subjectBoundaryNoop.workspace.revision, subjectMovedTwice.workspace.revision);
  assert.equal(
    await prisma.auditEvent.count({ where: { actorId: "user-b", action: "SUBJECT_REORDERED", entityId: subject.id } }),
    subjectReorderAuditCount,
  );
  await assert.rejects(
    () => updateWorkspaceSubject("user-b", created.id, subject.id, {
      expectedWorkspaceRevision: subjectBoundaryNoop.workspace.revision,
      move: "DOWN",
      name: "禁止混合更新",
    }),
    (error: unknown) => error instanceof ApiError
      && error.code === "MOVE_PATCH_CONFLICT"
      && error.status === 400,
  );
  assert.equal(
    (await prisma.examWorkspace.findUniqueOrThrow({ where: { id: created.id } })).revision,
    subjectBoundaryNoop.workspace.revision,
  );

  const groupMoved = await updateSubjectGroup("user-b", created.id, group408.id, {
    expectedWorkspaceRevision: subjectBoundaryNoop.workspace.revision,
    move: "UP",
  });
  assert.deepEqual(
    await prisma.subjectGroup.findMany({
      where: { workspaceId: created.id, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { stableKey: true, sortOrder: true },
    }),
    [
      { stableKey: "408", sortOrder: 10 },
      { stableKey: "public", sortOrder: 20 },
    ],
  );
  const groupReorderAuditCount = await prisma.auditEvent.count({
    where: { actorId: "user-b", action: "SUBJECT_GROUP_REORDERED", entityId: group408.id },
  });
  const groupBoundaryNoop = await updateSubjectGroup("user-b", created.id, group408.id, {
    expectedWorkspaceRevision: groupMoved.workspace.revision,
    move: "UP",
  });
  assert.equal(groupBoundaryNoop.workspace.revision, groupMoved.workspace.revision);
  assert.equal(
    await prisma.auditEvent.count({ where: { actorId: "user-b", action: "SUBJECT_GROUP_REORDERED", entityId: group408.id } }),
    groupReorderAuditCount,
  );

  const archivedSubject = await updateWorkspaceSubject("user-b", created.id, subject.id, {
    expectedWorkspaceRevision: groupBoundaryNoop.workspace.revision,
    sortOrder: 5,
    archived: true,
  });
  assert.ok(archivedSubject.subject.archivedAt);
  const restoredSubject = await updateWorkspaceSubject("user-b", created.id, subject.id, {
    expectedWorkspaceRevision: archivedSubject.workspace.revision,
    archived: false,
  });
  assert.equal(restoredSubject.subject.archivedAt, null);

  const archivedGroup = await updateSubjectGroup("user-b", created.id, customGroup.group.id, {
    expectedWorkspaceRevision: restoredSubject.workspace.revision,
    sortOrder: 5,
    archived: true,
  });
  assert.ok(archivedGroup.group.archivedAt);
  const restoredGroup = await updateSubjectGroup("user-b", created.id, customGroup.group.id, {
    expectedWorkspaceRevision: archivedGroup.workspace.revision,
    archived: false,
  });
  assert.equal(restoredGroup.group.archivedAt, null);

  pass("atomic_workspace_setup_and_revision_writes", {
    atomicRollback,
    initialSubjectCount: initialRows.length,
    revisionDelta: restoredGroup.workspace.revision - created.revision,
    staleRevisionRejected,
  });
}

async function verifySubjectArchiveBoundaries(): Promise<void> {
  await prisma.user.create({
    data: { id: "user-subject-archive", email: "subject-archive@example.com", passwordHash: "x" },
  });
  const workspace = await createExamWorkspace("user-subject-archive", {
    stableKey: "subject-archive",
    name: "科目归档边界",
    subjects: [
      { stableKey: "primary", name: "主科目", color: "#2563eb" },
      { stableKey: "secondary", name: "备用科目", color: "#16a34a" },
    ],
  });
  const subjects = await prisma.subject.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { stableKey: "asc" },
  });
  const primary = subjects.find((subject) => subject.stableKey === "primary");
  const secondary = subjects.find((subject) => subject.stableKey === "secondary");
  assert.ok(primary);
  assert.ok(secondary);

  const note = await prisma.note.create({
    data: { subjectId: primary!.id, title: "归档复习", content: "x", kind: "CONCEPT" },
  });
  const schedule = await prisma.reviewSchedule.create({
    data: {
      workspaceId: workspace.id,
      targetType: "NOTE",
      noteId: note.id,
      dueDate: new Date("2026-07-26T00:00:00.000Z"),
    },
  });
  const activeSession = await prisma.studySession.create({
    data: { subjectId: primary!.id, status: "RUNNING", startedAt: new Date() },
  });
  await assert.rejects(
    () => updateWorkspaceSubject("user-subject-archive", workspace.id, primary!.id, {
      expectedWorkspaceRevision: workspace.revision,
      archived: true,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "ACTIVE_SESSION_BLOCKS_SUBJECT_ARCHIVE",
  );
  await prisma.studySession.delete({ where: { id: activeSession.id } });

  const archived = await updateWorkspaceSubject("user-subject-archive", workspace.id, primary!.id, {
    expectedWorkspaceRevision: workspace.revision,
    archived: true,
  });
  assert.ok(archived.subject.archivedAt);
  const pausedSchedule = await prisma.reviewSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
  assert.equal(pausedSchedule.status, "PAUSED");
  assert.equal(pausedSchedule.pausedReason, "SUBJECT_ARCHIVED");
  await assert.rejects(
    () => createStudyTask({
      idempotencyKey: "m1m3-archived-subject-task",
      subjectId: primary!.id,
      title: "不得写入归档科目",
      type: "focus",
      priority: "medium",
      estimatedMinutes: 25,
    }, "user-subject-archive"),
    (error: unknown) => error instanceof ApiError && error.code === "SUBJECT_ARCHIVED",
  );
  await assert.rejects(
    () => updateWorkspaceSubject("user-subject-archive", workspace.id, secondary!.id, {
      expectedWorkspaceRevision: archived.workspace.revision,
      archived: true,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "WORKSPACE_ACTIVE_SUBJECT_REQUIRED",
  );

  await prisma.user.create({
    data: { id: "user-subject-race", email: "subject-race@example.com", passwordHash: "x" },
  });
  const raceWorkspace = await createExamWorkspace("user-subject-race", {
    stableKey: "subject-race",
    name: "科目并发归档",
    subjects: [
      { stableKey: "left", name: "左", color: "#2563eb" },
      { stableKey: "right", name: "右", color: "#16a34a" },
    ],
  });
  const raceSubjects = await prisma.subject.findMany({ where: { workspaceId: raceWorkspace.id } });
  const archiveRace = await Promise.allSettled(raceSubjects.map((subject) =>
    updateWorkspaceSubject("user-subject-race", raceWorkspace.id, subject.id, {
      expectedWorkspaceRevision: raceWorkspace.revision,
      archived: true,
    })));
  assert.equal(archiveRace.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await prisma.subject.count({ where: { workspaceId: raceWorkspace.id, archivedAt: null } }), 1);

  pass("subject_archive_boundaries", {
    activeSessionBlocked: true,
    reviewSchedulePaused: true,
    archivedWriteRejected: true,
    lastSubjectPreserved: true,
    concurrentArchiveSerialized: true,
  });
}

async function verifyWorkspaceRecoverySwitchRace(): Promise<void> {
  await prisma.user.create({
    data: { id: "user-workspace-race", email: "workspace-race@example.com", passwordHash: "x" },
  });
  const first = await createExamWorkspace("user-workspace-race", {
    stableKey: "first",
    name: "第一工作区",
    subjects: [{ stableKey: "first", name: "第一科", color: "#2563eb" }],
  });
  const second = await createExamWorkspace("user-workspace-race", {
    stableKey: "second",
    name: "第二工作区",
    subjects: [{ stableKey: "second", name: "第二科", color: "#16a34a" }],
  });
  await startRecoveryV2("user-workspace-race", { reason: "workspace switch race" });

  await Promise.all([
    activateExamWorkspace("user-workspace-race", first.id, first.revision + 1),
    startRecoveryV2("user-workspace-race", { reason: "concurrent restart" }),
  ]);
  const activeWorkspace = await prisma.examWorkspace.findFirstOrThrow({
    where: { userId: "user-workspace-race", status: "ACTIVE" },
  });
  const activeRecoveries = await prisma.recoveryState.findMany({
    where: { userId: "user-workspace-race", status: "ACTIVE" },
  });
  assert.equal(activeWorkspace.id, first.id);
  assert.equal(activeRecoveries.length <= 1, true);
  assert.equal(activeRecoveries.every((recovery) => recovery.workspaceId === activeWorkspace.id), true);
  assert.equal(await prisma.recoveryState.count({
    where: { workspaceId: second.id, status: "ACTIVE" },
  }), 0);
  pass("workspace_recovery_switch_race", {
    activeWorkspaceId: activeWorkspace.id,
    activeRecoveryCount: activeRecoveries.length,
    archivedWorkspaceRecoveryCount: 0,
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
    expectedWorkspaceRevision: workspace!.revision,
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

  const missingOwnerPreview = await previewWorkspaceTakeover("user-a");
  assert.equal(missingOwnerPreview.eligibleSubjectIds.includes("subj-math"), false);
  assert.ok(missingOwnerPreview.unresolvedSubjectIds.includes("subj-math"));

  await prisma.auditEvent.createMany({
    data: ["subj-math", "task-1", "task-2", "task-3"].map((entityId) => ({
      actorId: "user-a",
      action: "LEGACY_FIXTURE_OWNER_EVIDENCE",
      entityType: entityId === "subj-math" ? "Subject" : "StudyTask",
      entityId,
    })),
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
    missingOwnerBlocked: true,
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

async function verifyAtomicFirstUseSetupTakeover(): Promise<void> {
  await prisma.user.create({
    data: { id: "user-c", email: "c@example.com", passwordHash: "x" },
  });
  await prisma.subject.createMany({
    data: [
      {
        id: "subj-setup-eligible",
        legacyCode: "ENGLISH",
        stableKey: "english",
        name: "英语",
        color: "#3b82f6",
      },
      {
        id: "subj-setup-unresolved",
        legacyCode: null,
        stableKey: "setup-unresolved",
        name: "待确认科目",
        color: "#999999",
      },
    ],
  });

  await assert.rejects(
    () => createExamWorkspace("user-c", {
      stableKey: "setup-failed",
      name: "不得残留",
      activate: true,
      subjects: [{ stableKey: "new-subject", name: "新科目", color: "#35d7c5" }],
      takeoverSubjectIds: ["subj-setup-unresolved"],
    }),
    (error: unknown) => error instanceof ApiError && error.code === "TAKEOVER_SUBJECT_NOT_ELIGIBLE",
  );
  assert.equal(await prisma.examWorkspace.count({ where: { userId: "user-c" } }), 0);
  assert.equal((await prisma.subject.findUniqueOrThrow({ where: { id: "subj-setup-unresolved" } })).workspaceId, null);

  await prisma.auditEvent.create({
    data: {
      actorId: "user-c",
      action: "LEGACY_FIXTURE_OWNER_EVIDENCE",
      entityType: "Subject",
      entityId: "subj-setup-eligible",
    },
  });
  await assert.rejects(
    () => createExamWorkspace("user-c", {
      stableKey: "setup-conflict",
      name: "不得因唯一约束报内部错误",
      activate: true,
      subjects: [{ stableKey: "english", name: "重复英语", color: "#35d7c5" }],
      takeoverSubjectIds: ["subj-setup-eligible"],
    }),
    (error: unknown) => error instanceof ApiError
      && error.code === "SUBJECT_STABLE_KEY_CONFLICT_WITH_TAKEOVER",
  );
  assert.equal(await prisma.examWorkspace.count({ where: { userId: "user-c" } }), 0);
  assert.equal((await prisma.subject.findUniqueOrThrow({ where: { id: "subj-setup-eligible" } })).workspaceId, null);

  const workspace = await createExamWorkspace("user-c", {
    stableKey: "setup-complete",
    name: "原子首次设置",
    activate: true,
    subjects: [{ stableKey: "new-subject", name: "新科目", color: "#35d7c5" }],
    takeoverSubjectIds: ["subj-setup-eligible"],
  });
  assert.equal(workspace.status, "ACTIVE");
  assert.equal((await prisma.subject.findUniqueOrThrow({ where: { id: "subj-setup-eligible" } })).workspaceId, workspace.id);
  assert.equal(await prisma.subject.count({ where: { workspaceId: workspace.id } }), 2);
  pass("atomic_first_use_setup_takeover", {
    failedWorkspaceCount: 0,
    activeWorkspaceId: workspace.id,
    subjectCount: 2,
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

  const edgeCount = await prisma.taskDependency.count();
  assert.equal(edgeCount, 2);

  const subject = await prisma.subject.findFirstOrThrow({
    where: { workspace: { userId: "user-a", status: "ACTIVE" }, archivedAt: null },
  });
  const [left, right] = await Promise.all([
    prisma.studyTask.create({
      data: { subjectId: subject.id, title: "并发环左", type: "focus", plannedDate: new Date("2026-07-24T00:00:00.000Z") },
    }),
    prisma.studyTask.create({
      data: { subjectId: subject.id, title: "并发环右", type: "focus", plannedDate: new Date("2026-07-24T00:00:00.000Z") },
    }),
  ]);
  const concurrentCycle = await Promise.allSettled([
    createTaskDependency("user-a", { predecessorId: left.id, successorId: right.id, type: "HARD" }),
    createTaskDependency("user-a", { predecessorId: right.id, successorId: left.id, type: "HARD" }),
  ]);
  assert.equal(concurrentCycle.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await prisma.taskDependency.count({
    where: {
      OR: [
        { predecessorId: left.id, successorId: right.id },
        { predecessorId: right.id, successorId: left.id },
      ],
    },
  }), 1);

  pass("dependency_cycle_and_self_loop", {
    cycleBlocked,
    selfLoopBlocked,
    edgeCount,
    concurrentOppositeEdgeSerialized: true,
  });
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

  const milestoneCommandKey = `m1-m3-milestone-${randomUUID()}`;
  const milestone = await createPlanMilestone("user-a", {
    idempotencyKey: milestoneCommandKey,
    stagePlanId: stagePlan.id,
    expectedStagePlanRevision: stagePlan.revision,
    stableKey: "m1",
    title: "里程碑 1",
  });
  const milestoneReplay = await createPlanMilestone("user-a", {
    idempotencyKey: milestoneCommandKey,
    stagePlanId: stagePlan.id,
    expectedStagePlanRevision: stagePlan.revision,
    stableKey: "m1",
    title: "里程碑 1",
  });
  assert.equal(milestoneReplay.id, milestone.id);
  assert.equal(await prisma.planMilestone.count({ where: { workspaceId: workspace!.id, stableKey: "m1" } }), 1);
  await assert.rejects(
    () => createPlanMilestone("user-a", {
      idempotencyKey: milestoneCommandKey,
      stagePlanId: stagePlan.id,
      expectedStagePlanRevision: stagePlan.revision,
      stableKey: "m1",
      title: "同键异内容",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "PLAN_MILESTONE_IDEMPOTENCY_CONFLICT");
      assert.equal(error.status, 409);
      assert.deepEqual(error.details?.conflictFields, ["idempotencyKey", "requestFingerprint"]);
      assert.equal(error.details?.workbench, "/roadmap/stages");
      const latest = error.details?.latest as { kind?: unknown; milestone?: { id?: unknown }; stagePlan?: { id?: unknown } } | undefined;
      assert.equal(latest?.kind, "plan-milestone");
      assert.equal(latest?.milestone?.id, milestone.id);
      assert.equal(latest?.stagePlan?.id, stagePlan.id);
      return true;
    },
  );
  await assert.rejects(
    () => updatePlanMilestone("user-a", milestone.id, {
      expectedRevision: milestone.revision + 1,
      archive: true,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "PLAN_MILESTONE_REVISION_CONFLICT");
      assert.deepEqual(error.details?.conflictFields, ["revision"]);
      assert.equal(error.details?.workbench, "/roadmap/stages");
      const latest = error.details?.latest as { kind?: unknown; milestone?: { id?: unknown; revision?: unknown } } | undefined;
      assert.equal(latest?.kind, "plan-milestone");
      assert.equal(latest?.milestone?.id, milestone.id);
      assert.equal(latest?.milestone?.revision, milestone.revision);
      return true;
    },
  );

  const item = await createPlanInboxItem("user-a", {
    stableKey: "inbox-1",
    originKey: "daily-review:2026-07-21",
    originVersion: 1,
    originType: "DAILY_REVIEW",
    originSnapshot: { source: "selftest" },
    title: "明日最低行动",
  });

  await assert.rejects(
    () => createPlanInboxItem("user-a", {
      stableKey: "inbox-invalid-subject",
      originKey: "inbox-invalid-subject",
      originVersion: 1,
      originType: "SELFTEST",
      originSnapshot: { source: "selftest" },
      title: "关系冲突必须返回当前基线",
      subjectId: "missing-subject",
    }),
    (error: unknown) => {
      if (!(error instanceof ApiError) || error.code !== "PLAN_INBOX_SUBJECT_INVALID" || error.status !== 409) return false;
      const latest = error.details?.latest as { kind?: unknown; item?: unknown; relations?: { subject?: unknown } } | undefined;
      return latest?.kind === "plan-inbox-relations"
        && latest.item === null
        && latest.relations?.subject === null
        && error.details?.conflictFields?.includes("subjectId") === true;
    },
  );

  const reused = await createPlanInboxItem("user-a", {
    stableKey: "inbox-1",
    originKey: "daily-review:2026-07-21",
    originVersion: 1,
    originType: "DAILY_REVIEW",
    originSnapshot: { source: "selftest" },
    title: "明日最低行动",
  });
  assert.equal(reused.id, item.id);
  assert.equal(reused.title, item.title);
  assert.equal(await prisma.planInboxItem.count({
    where: {
      workspaceId: workspace!.id,
      originKey: "daily-review:2026-07-21",
      originVersion: 1,
    },
  }), 1);

  await assert.rejects(
    () => createPlanInboxItem("user-a", {
      stableKey: "inbox-conflict",
      originKey: "daily-review:2026-07-21",
      originVersion: 1,
      originType: "DAILY_REVIEW",
      originSnapshot: { source: "different-content" },
      title: "不得静默复用",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "PLAN_INBOX_ORIGIN_CONFLICT",
  );

  const versionTwoInput = {
    stableKey: "inbox-2",
    originKey: "daily-review:2026-07-21",
    originVersion: 2,
    originType: "DAILY_REVIEW",
    originSnapshot: { source: "selftest-v2" },
    title: "明日最低行动 v2",
  };
  const concurrent = await Promise.all([
    createPlanInboxItem("user-a", versionTwoInput),
    createPlanInboxItem("user-a", versionTwoInput),
  ]);
  assert.equal(concurrent[0]!.id, concurrent[1]!.id);
  assert.equal(await prisma.planInboxItem.count({
    where: {
      workspaceId: workspace!.id,
      originKey: versionTwoInput.originKey,
      originVersion: versionTwoInput.originVersion,
    },
  }), 1);
  const superseded = await prisma.planInboxItem.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(superseded.supersededByItemId, concurrent[0]!.id);

  await createPlanInboxItem("user-a", {
    stableKey: "newer-first-v2",
    originKey: "newer-first",
    originVersion: 2,
    originType: "SELFTEST",
    originSnapshot: { source: "v2" },
    title: "新版本",
  });
  await assert.rejects(
    () => createPlanInboxItem("user-a", {
      stableKey: "newer-first-v1",
      originKey: "newer-first",
      originVersion: 1,
      originType: "SELFTEST",
      originSnapshot: { source: "v1" },
      title: "倒序旧版本",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "PLAN_INBOX_ORIGIN_VERSION_STALE",
  );

  const current = concurrent[0]!;
  const dismissed = await dismissPlanInboxItem("user-a", current.id, current.revision);
  assert.equal(dismissed.status, "DISMISSED");

  const subject = await prisma.subject.findFirstOrThrow({
    where: { workspaceId: workspace!.id, archivedAt: null },
  });
  const convertible = await createPlanInboxItem("user-a", {
    stableKey: "convert-idempotency",
    originKey: "convert-idempotency",
    originVersion: 1,
    originType: "SELFTEST",
    originSnapshot: { source: "selftest" },
    title: "幂等转换",
    subjectId: subject.id,
    plannedDate: "2026-07-29T00:00:00.000Z",
    estimatedMinutes: 25,
    priority: "HIGH",
    type: "focus",
  });
  const convertInput = {
    expectedRevision: convertible.revision,
    idempotencyKey: "m1m3-plan-inbox-convert-recovery",
  };
  const firstConvert = await convertPlanInboxItem("user-a", convertible.id, convertInput);
  const recoveredConvert = await convertPlanInboxItem("user-a", convertible.id, convertInput);
  assert.equal(recoveredConvert.id, firstConvert.id);
  assert.equal(recoveredConvert.convertedTaskId, firstConvert.convertedTaskId);
  assert.equal(await prisma.studyTask.count({ where: { id: firstConvert.convertedTaskId! } }), 1);
  assert.equal(await prisma.auditEvent.count({
    where: {
      actorId: "user-a",
      action: "PLAN_INBOX_CONVERTED",
      entityType: "PlanInboxItem",
      AND: [
        { metadata: { path: ["workspaceId"], equals: workspace!.id } },
        { metadata: { path: ["idempotencyKey"], equals: convertInput.idempotencyKey } },
      ],
    },
  }), 1);

  await assert.rejects(
    () => convertPlanInboxItem("user-a", convertible.id, {
      ...convertInput,
      expectedRevision: convertInput.expectedRevision + 1,
    }),
    (error: unknown) => assertPlanInboxConflict(error, "PLAN_INBOX_IDEMPOTENCY_CONFLICT", convertible.id, ["idempotencyKey", "requestFingerprint"]),
  );

  const otherConvertible = await createPlanInboxItem("user-a", {
    stableKey: "convert-idempotency-other",
    originKey: "convert-idempotency-other",
    originVersion: 1,
    originType: "SELFTEST",
    originSnapshot: { source: "selftest" },
    title: "不得跨项目复用命令",
    subjectId: subject.id,
    plannedDate: "2026-07-30T00:00:00.000Z",
    estimatedMinutes: 25,
  });
  await assert.rejects(
    () => convertPlanInboxItem("user-a", otherConvertible.id, {
      expectedRevision: otherConvertible.revision,
      idempotencyKey: convertInput.idempotencyKey,
    }),
    (error: unknown) => assertPlanInboxConflict(error, "PLAN_INBOX_IDEMPOTENCY_CONFLICT", otherConvertible.id, ["idempotencyKey", "requestFingerprint"]),
  );

  const concurrentConvertible = await createPlanInboxItem("user-a", {
    stableKey: "convert-idempotency-concurrent",
    originKey: "convert-idempotency-concurrent",
    originVersion: 1,
    originType: "SELFTEST",
    originSnapshot: { source: "selftest" },
    title: "并发幂等转换",
    subjectId: subject.id,
    plannedDate: "2026-07-31T00:00:00.000Z",
    estimatedMinutes: 25,
  });
  const concurrentInput = {
    expectedRevision: concurrentConvertible.revision,
    idempotencyKey: "m1m3-plan-inbox-convert-concurrent",
  };
  const concurrentConvert = await Promise.all([
    convertPlanInboxItem("user-a", concurrentConvertible.id, concurrentInput),
    convertPlanInboxItem("user-a", concurrentConvertible.id, concurrentInput),
  ]);
  assert.equal(concurrentConvert[0]!.convertedTaskId, concurrentConvert[1]!.convertedTaskId);

  await assert.rejects(
    () => updatePlanInboxItem("user-a", otherConvertible.id, {
      expectedRevision: otherConvertible.revision + 1,
      title: "过期 revision 不得覆盖",
    }),
    (error: unknown) => assertPlanInboxConflict(error, "PLAN_INBOX_REVISION_CONFLICT", otherConvertible.id, ["revision"]),
  );

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
    sameOriginVersionReused: true,
    sameOriginVersionConflictRejected: true,
    concurrentSameRequestReused: true,
    olderOpenVersionSuperseded: true,
    staleOriginVersionRejected: true,
    convertUnknownResultRecovered: true,
    convertIdempotencyBoundToItemAndRevision: true,
    concurrentConvertCreatedOnce: true,
    conflictIncludesLatestFieldsAndWorkbench: true,
    createRelationConflictIncludesLatestBaseline: true,
    convertedWithoutTaskRejected,
  });
}

function assertPlanInboxConflict(
  error: unknown,
  code: string,
  itemId: string,
  expectedFields: string[],
): boolean {
  if (!(error instanceof ApiError) || error.code !== code || error.status !== 409) return false;
  const latest = error.details?.latest as { id?: unknown; revision?: unknown; status?: unknown } | undefined;
  return latest?.id === itemId
    && typeof latest.revision === "number"
    && typeof latest.status === "string"
    && error.details?.workbench === "/roadmap/allocation/drafts"
    && expectedFields.every((field) => error.details?.conflictFields?.includes(field));
}

function pass(id: string, details: Record<string, string | number | boolean>): void {
  checks.push({ id, status: "pass", details });
}

void createHash;
