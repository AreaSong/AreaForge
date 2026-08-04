import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mintAiDraftResultProof } from "../../packages/auth/src/index";
import { prisma } from "../../packages/db/src/index";
import { ApiError } from "../../apps/web/lib/api/responses";
import { listWorkspaceCheckIns } from "../../apps/web/lib/study/check-in-service";
import { activateExamWorkspace } from "../../apps/web/lib/study/exam-workspace-service";
import { createMistake } from "../../apps/web/lib/study/mistakes-service";
import {
  adoptAiPlanDraftToInbox,
  convertPlanInboxItem,
  createLowConversionPlanInboxItem,
  createPlanInboxItem,
  createUserPlanInboxItem,
  dismissPlanInboxItem,
  matchesPlanInboxStableRef,
  updatePlanInboxItem,
} from "../../apps/web/lib/study/plan-inbox-service";
import { planInboxClientCreateSchema } from "../../apps/web/app/api/plan-inbox/route";
import { planInboxConvertSchema } from "../../apps/web/app/api/plan-inbox/[id]/convert/route";
import {
  applyRecoveryDayProgress,
  cancelRecoveryV2,
  getActiveRecoveryV2,
  restartRecoveryV2,
  startRecoveryV2,
} from "../../apps/web/lib/study/recovery-v2-service";
import {
  abandonBridgeTask,
  completeBridgeTaskWithReview,
  confirmReviewEvent,
  correctReviewEvent,
  createBridgeTask,
  deferBridgeTask,
  materializeReviewSchedule,
  pauseReviewSchedule,
  rescheduleReview,
  resumeReviewSchedule,
} from "../../apps/web/lib/study/review-schedule-service";
import { getReviewTarget } from "../../apps/web/lib/study/review-target-service";
import {
  completeStudyTask,
  createStudyTask,
  endStudySession,
  splitStudyTask,
  startStudySession,
  updateStudyTask,
} from "../../apps/web/lib/study/service";
import { getTaskUpdateSnapshot } from "../../apps/web/lib/study/task-detail-service";
import { getStudyDayRange } from "../../apps/web/lib/study/date";

/**
 * Batch 6 隔离 runtime selftest：
 * - ReviewSchedule exactly-one / pause-resume / confirm 幂等与 fingerprint 409
 * - correction 单 successor
 * - CheckIn v2 升级与 review 不计入 effectiveMinutes
 * - Recovery 三阶 / 单日一阶
 * - 桥接 partial unique / 放弃不取消排期
 * - PlanInbox convert 原子性
 * 硬验收并发/事务 fixture：
 * - 零时长拒绝
 * - Event 不可变（correction 不改原行）
 * - correction stale revision CAS 409
 * - CheckIn sourceVersion 1→2 触达升级
 * - 桥接完成必须有 ReviewEvent.result；普通 complete 拒绝桥接
 */

const checks: Array<{ id: string; status: "pass"; details: Record<string, string | number | boolean> }> = [];
if (!process.env.AUTH_SESSION_SECRET || process.env.AUTH_SESSION_SECRET.length < 32) {
  process.env.AUTH_SESSION_SECRET = "v11-m6-isolated-auth-session-secret-20260726";
}

try {
  await assertIsolatedDatabase();
  await verifyRoutesExist();
  await verifyMigration6Schema();
  await resetTables();
  const seed = await seedWorkspace();
  await verifyMistakeCompletenessGate(seed);
  await verifyTaskCanonicalRelations(seed);
  await verifyResourceTaskAndShortcutSession(seed);
  await verifyScheduleConstraints(seed);
  await verifyConfirmIdempotencyAndCheckIn(seed);
  await verifyQuickReviewActivityExclusion(seed);
  await verifyCorrectionSingleSuccessor(seed);
  await verifyBridgeAndInboxConvert(seed);
  await verifyBridgeWorkspaceSwitchBoundary();
  await verifyTrustedInboxAdoptions(seed);
  await verifyRecoveryStages(seed);
  await verifyHardConcurrencyFixtures(seed);

  console.log(
    JSON.stringify(
      {
        schemaVersion: "v11-m6-runtime-selftest-v1",
        status: "pass",
        checks,
      },
      null,
      2,
    ),
  );
  console.log("PASS v11 M6 isolated PostgreSQL runtime selftest");
} finally {
  await prisma.$disconnect();
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_V11_M6_ISOLATED_DB !== "1") {
    throw new Error("v11 M6 runtime selftest requires AREAFORGE_V11_M6_ISOLATED_DB=1");
  }
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!rows[0]?.current_database.includes("v11m6")) {
    throw new Error("v11 M6 runtime selftest refused a database without the isolated name marker");
  }
  pass("isolated_database", { database: rows[0].current_database });
}

async function verifyRoutesExist(): Promise<void> {
  const routes = [
    "apps/web/app/api/review-schedules/route.ts",
    "apps/web/app/api/review-schedules/[id]/events/route.ts",
    "apps/web/app/api/review-events/[id]/corrections/route.ts",
    "apps/web/app/api/check-ins/route.ts",
    "apps/web/app/api/recovery/start/route.ts",
    "apps/web/app/api/plan-inbox/[id]/convert/route.ts",
    "apps/web/app/api/plan-inbox/ai-plan-adoptions/route.ts",
    "apps/web/app/api/plan-inbox/low-conversion/route.ts",
  ];
  for (const route of routes) {
    assert.equal(existsSync(join(process.cwd(), route)), true);
  }
  pass("isolated_routes_exist", { count: routes.length });
}

async function verifyMigration6Schema(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('ReviewSchedule', 'ReviewEvent')
  `;
  assert.equal(tables.length, 2);
  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'ReviewSchedule_noteId_uidx',
        'ReviewEvent_reviewScheduleId_idempotencyKey_key',
        'StudyTask_reviewSchedule_active_bridge_uidx',
        'RecoveryState_user_workspace_active_uidx',
        'ReviewEvent_correctedEventId_uidx'
      )
  `;
  assert.equal(indexes.length, 5);
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'CheckIn'
      AND column_name IN ('reviewCount', 'reviewSeconds', 'minimumActionSource')
  `;
  assert.equal(columns.length, 3);
  pass("migration6_schema", { tables: tables.length, indexes: indexes.length, columns: columns.length });
}

async function resetTables(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "MasteryEvidence",
      "MasteryRetest",
      "ReviewEvent",
      "StudyTask",
      "ReviewSchedule",
      "PlanInboxDependencyRef",
      "PlanInboxItem",
      "CheckIn",
      "RecoveryState",
      "Note",
      "Mistake",
      "SyllabusNode",
      "StudyResourceTag",
      "StudyResourceTaskLink",
      "StudyResourceNoteLink",
      "StudyResourceMistakeLink",
      "StudyResourceSyllabusNodeLink",
      "StudyResource",
      "Attachment",
      "Subject",
      "SubjectGroup",
      "ExamWorkspace",
      "AuditEvent",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

async function seedWorkspace() {
  const user = await prisma.user.create({
    data: {
      email: `v11m6-${randomUUID()}@example.com`,
      passwordHash: "x",
    },
  });
  const workspace = await prisma.examWorkspace.create({
    data: {
      userId: user.id,
      stableKey: "m6-workspace",
      name: "M6 Workspace",
      status: "ACTIVE",
      revision: 1,
    },
  });
  const subject = await prisma.subject.create({
    data: {
      workspaceId: workspace.id,
      stableKey: "math",
      name: "Math",
      color: "#111111",
    },
  });
  const note = await prisma.note.create({
    data: {
      subjectId: subject.id,
      title: "Concept card",
      content: "body",
      kind: "CONCEPT",
      nextReviewAt: getStudyDayRange().start,
    },
  });
  const mistake = await prisma.mistake.create({
    data: {
      subjectId: subject.id,
      title: "Mistake 1",
      cause: "WRONG_APPROACH",
      correctIdea: "先识别约束，再选择正确方法。",
      nextReviewAt: getStudyDayRange().start,
    },
  });
  return { user, workspace, subject, note, mistake };
}

async function verifyMistakeCompletenessGate(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  await assert.rejects(
    () => createMistake({
      idempotencyKey: `m6-incomplete-cause-${randomUUID()}`,
      subjectId: seed.subject.id,
      title: "Missing explicit cause",
      cause: "unknown",
      correctIdea: "已有正确思路",
    }, seed.user.id),
    (error: unknown) => error instanceof ApiError && error.code === "MISTAKE_INCOMPLETE" && error.status === 400,
  );
  await assert.rejects(
    () => createMistake({
      idempotencyKey: `m6-incomplete-idea-${randomUUID()}`,
      subjectId: seed.subject.id,
      title: "Missing correct idea",
      cause: "wrong_approach",
    }, seed.user.id),
    (error: unknown) => error instanceof ApiError && error.code === "MISTAKE_INCOMPLETE" && error.status === 400,
  );

  const legacyIncomplete = await prisma.mistake.create({
    data: {
      subjectId: seed.subject.id,
      title: "Legacy incomplete mistake",
      cause: "UNKNOWN",
      correctIdea: null,
      nextReviewAt: getStudyDayRange().start,
    },
  });
  const dueDate = getStudyDayRange().start.toISOString();
  await assert.rejects(
    () => materializeReviewSchedule(seed.user.id, {
      targetType: "MISTAKE",
      mistakeId: legacyIncomplete.id,
      dueDate,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "REVIEW_TARGET_INCOMPLETE" && error.status === 409,
  );

  const legacySchedule = await prisma.reviewSchedule.create({
    data: {
      workspaceId: seed.workspace.id,
      targetType: "MISTAKE",
      mistakeId: legacyIncomplete.id,
      status: "ACTIVE",
      dueDate: getStudyDayRange().start,
      revision: 1,
      actorId: seed.user.id,
    },
  });
  const target = await getReviewTarget(seed.user.id, legacySchedule.id);
  assert.equal(target.canPass, false);
  for (const result of ["PASSED", "PARTIAL", "FAILED"] as const) {
    await assert.rejects(
      () => confirmReviewEvent(seed.user.id, legacySchedule.id, {
        idempotencyKey: `legacy-incomplete-${result.toLowerCase()}-${randomUUID()}`,
        expectedRevision: legacySchedule.revision,
        result,
        durationSeconds: 60,
      }),
      (error: unknown) => error instanceof ApiError && error.code === "REVIEW_TARGET_INCOMPLETE" && error.status === 409,
    );
  }
  assert.equal(await prisma.reviewEvent.count({ where: { reviewScheduleId: legacySchedule.id } }), 0);
  pass("mistake_completeness_gate", {
    legacyMistakeId: legacyIncomplete.id,
    legacyScheduleId: legacySchedule.id,
    canPass: target.canPass,
  });
}

async function verifyTaskCanonicalRelations(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const [primaryNode, relatedNode, replacementNode] = await Promise.all([
    prisma.syllabusNode.create({ data: { subjectId: seed.subject.id, title: "Task primary", kind: "TOPIC" } }),
    prisma.syllabusNode.create({ data: { subjectId: seed.subject.id, title: "Task related", kind: "TOPIC" } }),
    prisma.syllabusNode.create({ data: { subjectId: seed.subject.id, title: "Task replacement", kind: "TOPIC" } }),
  ]);
  const stagePlan = await prisma.stagePlan.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: `task-stage-${randomUUID()}`,
      name: "Task stage",
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      goal: "Validate canonical task relations",
      mode: "maintain",
      status: "active",
    },
  });
  const secondaryStagePlan = await prisma.stagePlan.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: `task-stage-secondary-${randomUUID()}`,
      name: "Task secondary stage",
      startDate: new Date(),
      endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      goal: "Validate multi-stage task inheritance",
      mode: "strengthen",
      status: "active",
    },
  });
  const primaryKnowledgePoint = await prisma.knowledgePoint.create({
    data: {
      userId: seed.user.id,
      workspaceId: seed.workspace.id,
      primarySubjectId: seed.subject.id,
      stableKey: `task-knowledge-primary-${randomUUID()}`,
      title: "Task knowledge point",
    },
  });
  const replacementKnowledgePoint = await prisma.knowledgePoint.create({
    data: {
      userId: seed.user.id,
      workspaceId: seed.workspace.id,
      primarySubjectId: seed.subject.id,
      stableKey: `task-knowledge-replacement-${randomUUID()}`,
      title: "Replacement knowledge point",
    },
  });
  const mismatchedSubject = await prisma.subject.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: `task-knowledge-mismatch-${randomUUID()}`,
      name: "Mismatched subject",
      color: "#222222",
    },
  });
  const mismatchedKnowledgePoint = await prisma.knowledgePoint.create({
    data: {
      userId: seed.user.id,
      workspaceId: seed.workspace.id,
      primarySubjectId: mismatchedSubject.id,
      stableKey: `task-knowledge-mismatch-point-${randomUUID()}`,
      title: "Mismatched subject point",
    },
  });
  const foreignUser = await prisma.user.create({
    data: { email: `task-knowledge-foreign-${randomUUID()}@example.com`, passwordHash: "x" },
  });
  const foreignWorkspace = await prisma.examWorkspace.create({
    data: {
      userId: foreignUser.id,
      stableKey: `task-knowledge-foreign-workspace-${randomUUID()}`,
      name: "Foreign workspace",
      status: "ACTIVE",
    },
  });
  const foreignSubject = await prisma.subject.create({
    data: {
      workspaceId: foreignWorkspace.id,
      stableKey: "foreign-subject",
      name: "Foreign subject",
      color: "#333333",
    },
  });
  const foreignKnowledgePoint = await prisma.knowledgePoint.create({
    data: {
      userId: foreignUser.id,
      workspaceId: foreignWorkspace.id,
      primarySubjectId: foreignSubject.id,
      stableKey: `task-knowledge-foreign-point-${randomUUID()}`,
      title: "Foreign workspace point",
    },
  });
  const milestone = await prisma.planMilestone.create({
    data: {
      workspaceId: seed.workspace.id,
      stagePlanId: stagePlan.id,
      subjectId: seed.subject.id,
      stableKey: `task-milestone-${randomUUID()}`,
      title: "Task milestone",
    },
  });
  const idempotencyKey = `task-canonical-${randomUUID()}`;
  const createInput = {
    idempotencyKey,
    subjectId: seed.subject.id,
    syllabusNodeId: primaryNode.id,
    relatedSyllabusNodeIds: [relatedNode.id],
    planMilestoneId: milestone.id,
    stagePlanIds: [stagePlan.id, secondaryStagePlan.id],
    knowledgePointIds: [primaryKnowledgePoint.id],
    title: "Canonical task",
    type: "study",
    priority: "high" as const,
    estimatedMinutes: 35,
  };
  const created = await createStudyTask(createInput, seed.user.id);
  const replay = await createStudyTask(createInput, seed.user.id);
  assert.equal(replay.id, created.id);
  const persisted = await prisma.studyTask.findUniqueOrThrow({
    where: { id: created.id },
    include: { relatedSyllabusNodes: true, stageLinks: true, knowledgePointLinks: true },
  });
  assert.equal(persisted.planMilestoneId, milestone.id);
  assert.equal(persisted.syllabusNodeId, primaryNode.id);
  assert.deepEqual(persisted.relatedSyllabusNodes.map((relation) => relation.syllabusNodeId), [relatedNode.id]);
  assert.deepEqual(
    persisted.stageLinks.map((relation) => relation.stagePlanId).sort(),
    [stagePlan.id, secondaryStagePlan.id].sort(),
  );
  assert.deepEqual(
    persisted.knowledgePointLinks.map((relation) => relation.knowledgePointId),
    [primaryKnowledgePoint.id],
  );

  await assert.rejects(
    () => createStudyTask({ ...createInput, idempotencyKey: `task-knowledge-duplicate-${randomUUID()}`, knowledgePointIds: [primaryKnowledgePoint.id, primaryKnowledgePoint.id] }, seed.user.id),
    (error: unknown) => error instanceof ApiError
      && error.code === "TASK_KNOWLEDGE_POINT_DUPLICATE"
      && error.status === 400,
  );
  await assert.rejects(
    () => createStudyTask({ ...createInput, idempotencyKey: `task-knowledge-mismatch-${randomUUID()}`, knowledgePointIds: [mismatchedKnowledgePoint.id] }, seed.user.id),
    (error: unknown) => error instanceof ApiError
      && error.code === "TASK_KNOWLEDGE_POINT_RELATION_INVALID"
      && error.status === 409,
  );
  await assert.rejects(
    () => createStudyTask({ ...createInput, idempotencyKey: `task-knowledge-foreign-${randomUUID()}`, knowledgePointIds: [foreignKnowledgePoint.id] }, seed.user.id),
    (error: unknown) => error instanceof ApiError
      && error.code === "TASK_KNOWLEDGE_POINT_RELATION_INVALID"
      && error.status === 409,
  );

  const baseline = await getTaskUpdateSnapshot(seed.user.id, created.id);
  await updateStudyTask(created.id, {
    expectedStatus: baseline.status,
    expectedUpdatedAt: baseline.updatedAt,
    syllabusNodeId: relatedNode.id,
    relatedSyllabusNodeIds: [replacementNode.id],
    knowledgePointIds: [replacementKnowledgePoint.id],
    title: "Canonical task updated",
  }, seed.user.id);
  const latest = await getTaskUpdateSnapshot(seed.user.id, created.id);
  assert.equal(latest.syllabusNodeId, relatedNode.id);
  assert.deepEqual(latest.relatedSyllabusNodeIds, [replacementNode.id]);
  assert.deepEqual(latest.stagePlanIds.sort(), [stagePlan.id, secondaryStagePlan.id].sort());
  assert.deepEqual(latest.knowledgePointIds, [replacementKnowledgePoint.id]);
  assert.notEqual(latest.updatedAt, baseline.updatedAt);

  const split = await splitStudyTask(created.id, {
    title: "Canonical child task",
    estimatedMinutes: 15,
  }, seed.user.id);
  assert.deepEqual(split.task.stagePlanIds.sort(), [stagePlan.id, secondaryStagePlan.id].sort());
  assert.equal(split.task.syllabusNodeId, latest.syllabusNodeId);
  assert.deepEqual(split.task.knowledgePointIds, [replacementKnowledgePoint.id]);
  const childPersisted = await prisma.studyTask.findUniqueOrThrow({
    where: { id: split.task.id },
    include: { relatedSyllabusNodes: true, stageLinks: true, knowledgePointLinks: true },
  });
  assert.equal(childPersisted.planMilestoneId, milestone.id);
  assert.deepEqual(childPersisted.relatedSyllabusNodes.map((relation) => relation.syllabusNodeId), [replacementNode.id]);
  assert.deepEqual(childPersisted.knowledgePointLinks.map((relation) => relation.knowledgePointId), [replacementKnowledgePoint.id]);
  const latestAfterSplit = await getTaskUpdateSnapshot(seed.user.id, created.id);

  await assert.rejects(
    () => updateStudyTask(created.id, {
      expectedStatus: baseline.status,
      expectedUpdatedAt: baseline.updatedAt,
      title: "stale overwrite",
    }, seed.user.id),
    (error: unknown) => error instanceof ApiError
      && error.code === "TASK_STATE_CONFLICT"
      && error.status === 409
      && error.details?.workbench === "/roadmap/allocation"
      && (error.details.latest as { updatedAt?: string } | undefined)?.updatedAt === latestAfterSplit.updatedAt,
  );
  pass("task_canonical_relations_and_cas", {
    taskId: created.id,
    replayed: replay.id === created.id,
    relatedNodeCount: latest.relatedSyllabusNodeIds.length,
    inheritedStageCount: split.task.stagePlanIds.length,
    inheritedKnowledgePointCount: split.task.knowledgePointIds.length,
    inheritedMilestone: childPersisted.planMilestoneId === milestone.id,
    relationValidationCases: 3,
    staleRejected: true,
  });
}

async function verifyResourceTaskAndShortcutSession(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const otherSubject = await prisma.subject.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: `shortcut-other-${randomUUID()}`,
      name: "Shortcut other subject",
      color: "#222222",
    },
  });
  const [primaryNode, overrideNode] = await Promise.all([
    prisma.syllabusNode.create({ data: { subjectId: seed.subject.id, title: "Resource primary", kind: "TOPIC" } }),
    prisma.syllabusNode.create({ data: { subjectId: seed.subject.id, title: "Resource override", kind: "TOPIC" } }),
  ]);
  const resource = await prisma.studyResource.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: `resource-task-${randomUUID()}`,
      title: "Resource task source",
      category: "OTHER",
      sourceType: "LINK",
      subjectId: seed.subject.id,
      externalUrl: "https://example.com/resource-task",
      displayHost: "example.com",
    },
  });
  const idempotencyKey = `resource-task-${randomUUID()}`;
  const input = {
    idempotencyKey,
    sourceResourceId: resource.id,
    subjectId: seed.subject.id,
    syllabusNodeId: primaryNode.id,
    title: "Task created from resource",
    type: "study",
    priority: "medium" as const,
    estimatedMinutes: 25,
  };
  const created = await createStudyTask(input, seed.user.id);
  const replay = await createStudyTask(input, seed.user.id);
  assert.equal(replay.id, created.id);
  assert.equal(await prisma.studyResourceTaskLink.count({ where: { resourceId: resource.id, taskId: created.id } }), 1);
  assert.equal((await prisma.studyResource.findUniqueOrThrow({ where: { id: resource.id } })).revision, resource.revision + 1);

  await assert.rejects(
    () => createStudyTask({ ...input, sourceResourceId: undefined, title: "Changed replay payload" }, seed.user.id),
    (error: unknown) => error instanceof ApiError && error.code === "STUDY_TASK_IDEMPOTENCY_CONFLICT",
  );

  const archivedResource = await prisma.studyResource.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: `resource-archived-${randomUUID()}`,
      title: "Archived resource",
      category: "OTHER",
      sourceType: "LINK",
      subjectId: seed.subject.id,
      externalUrl: "https://example.com/archived-resource",
      displayHost: "example.com",
      archivedAt: new Date(),
    },
  });
  const mismatchedResource = await prisma.studyResource.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: `resource-mismatch-${randomUUID()}`,
      title: "Mismatched resource",
      category: "OTHER",
      sourceType: "LINK",
      subjectId: seed.subject.id,
      externalUrl: "https://example.com/mismatched-resource",
      displayHost: "example.com",
    },
  });
  const foreignUser = await prisma.user.create({
    data: { email: `v11m6-resource-foreign-${randomUUID()}@example.com`, passwordHash: "x" },
  });
  const foreignWorkspace = await prisma.examWorkspace.create({
    data: { userId: foreignUser.id, stableKey: "m6-resource-foreign", name: "Foreign", status: "ACTIVE" },
  });
  const foreignResource = await prisma.studyResource.create({
    data: {
      workspaceId: foreignWorkspace.id,
      stableKey: `resource-foreign-${randomUUID()}`,
      title: "Foreign resource",
      category: "OTHER",
      sourceType: "LINK",
      externalUrl: "https://example.com/foreign-resource",
      displayHost: "example.com",
    },
  });
  const taskCountBeforeFailures = await prisma.studyTask.count();
  const linkCountBeforeFailures = await prisma.studyResourceTaskLink.count();
  const failureCases = [
    {
      sourceResourceId: archivedResource.id,
      subjectId: seed.subject.id,
      code: "STUDY_RESOURCE_ARCHIVED",
    },
    {
      sourceResourceId: mismatchedResource.id,
      subjectId: otherSubject.id,
      code: "STUDY_RESOURCE_SUBJECT_MISMATCH",
    },
    {
      sourceResourceId: foreignResource.id,
      subjectId: seed.subject.id,
      code: "STUDY_RESOURCE_NOT_FOUND",
    },
  ];
  for (const [index, testCase] of failureCases.entries()) {
    await assert.rejects(
      () => createStudyTask({
        ...input,
        idempotencyKey: `resource-task-failure-${index}-${randomUUID()}`,
        sourceResourceId: testCase.sourceResourceId,
        subjectId: testCase.subjectId,
        syllabusNodeId: null,
      }, seed.user.id),
      (error: unknown) => error instanceof ApiError && error.code === testCase.code,
    );
  }
  assert.equal(await prisma.studyTask.count(), taskCountBeforeFailures);
  assert.equal(await prisma.studyResourceTaskLink.count(), linkCountBeforeFailures);

  const inherited = await startStudySession({
    subjectId: seed.subject.id,
    taskId: created.id,
    startSource: "SUBJECT_SHORTCUT",
  }, seed.user.id);
  assert.equal(inherited.syllabusNodeId, primaryNode.id);
  assert.equal(inherited.startSource, "SUBJECT_SHORTCUT");
  assert.equal(inherited.goalMinutes, null);
  await cancelFixtureSession(inherited.id);

  const cleared = await startStudySession({
    subjectId: seed.subject.id,
    taskId: created.id,
    syllabusNodeId: null,
    goalMinutes: null,
    startSource: "SUBJECT_SHORTCUT",
  }, seed.user.id);
  assert.equal(cleared.syllabusNodeId, null);
  await cancelFixtureSession(cleared.id);

  const overridden = await startStudySession({
    subjectId: seed.subject.id,
    taskId: created.id,
    syllabusNodeId: overrideNode.id,
    goalMinutes: 35,
    startSource: "SUBJECT_SHORTCUT",
  }, seed.user.id);
  assert.equal(overridden.syllabusNodeId, overrideNode.id);
  assert.equal(overridden.goalMinutes, 35);
  await cancelFixtureSession(overridden.id);

  await assert.rejects(
    () => startStudySession({
      subjectId: otherSubject.id,
      taskId: created.id,
      startSource: "SUBJECT_SHORTCUT",
    }, seed.user.id),
    (error: unknown) => error instanceof ApiError
      && error.code === "TASK_SUBJECT_MISMATCH"
      && error.details?.workbench === `/roadmap/allocation/tasks/${created.id}`,
  );
  assert.equal(await prisma.studySession.count({ where: { status: { in: ["RUNNING", "PAUSED"] } } }), 0);

  pass("resource_task_atomicity_and_shortcut_session", {
    resourceRevision: resource.revision + 1,
    replayReusedTask: true,
    failedCreatesRolledBack: failureCases.length,
    inheritedNode: true,
    explicitNodeClear: true,
    overriddenNode: true,
    subjectMismatchRejected: true,
  });
}

async function cancelFixtureSession(sessionId: string): Promise<void> {
  await prisma.studySession.update({
    where: { id: sessionId },
    data: { status: "CANCELED", endedAt: new Date() },
  });
}

async function verifyScheduleConstraints(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  const dueDate = getStudyDayRange().start.toISOString();
  const schedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: seed.note.id,
    dueDate,
  });
  assert.equal(schedule.targetType, "NOTE");
  assert.equal(schedule.status, "ACTIVE");

  const again = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: seed.note.id,
    dueDate,
  });
  assert.equal(again.id, schedule.id);

  await assert.rejects(
    () =>
      prisma.reviewSchedule.create({
        data: {
          workspaceId: seed.workspace.id,
          targetType: "NOTE",
          noteId: seed.note.id,
          mistakeId: seed.mistake.id,
          status: "ACTIVE",
          dueDate: getStudyDayRange().start,
        },
      }),
    /ReviewSchedule_target_exactly_one_check|P2010|Raw query/,
  );

  const paused = await pauseReviewSchedule(seed.user.id, schedule.id, {
    expectedRevision: schedule.revision,
    reason: "manual pause",
  });
  assert.equal(paused.status, "PAUSED");
  assert.equal(paused.dueDate, null);

  const resumed = await resumeReviewSchedule(seed.user.id, schedule.id, {
    expectedRevision: paused.revision,
    dueDate,
  });
  assert.equal(resumed.status, "ACTIVE");

  const rescheduleRace = await Promise.allSettled([
    rescheduleReview(seed.user.id, schedule.id, {
      expectedRevision: resumed.revision,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
    rescheduleReview(seed.user.id, schedule.id, {
      expectedRevision: resumed.revision,
      dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  ]);
  assert.equal(rescheduleRace.filter((result) => result.status === "fulfilled").length, 1);
  const rescheduleRejected = rescheduleRace.find((result) => result.status === "rejected");
  assert.ok(rescheduleRejected?.status === "rejected");
  assert.equal(
    rescheduleRejected.reason instanceof ApiError && rescheduleRejected.reason.code === "REVIEW_SCHEDULE_REVISION_CONFLICT",
    true,
  );
  const afterReschedule = await prisma.reviewSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
  assert.equal(afterReschedule.revision, resumed.revision + 1);

  const archivedTarget = await prisma.note.create({
    data: { subjectId: seed.subject.id, title: "Archived resume target", content: "x", kind: "CONCEPT" },
  });
  const archivedSchedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: archivedTarget.id,
    dueDate,
  });
  const pausedArchivedSchedule = await pauseReviewSchedule(seed.user.id, archivedSchedule.id, {
    expectedRevision: archivedSchedule.revision,
    reason: "manual before archive",
  });
  await prisma.note.update({ where: { id: archivedTarget.id }, data: { archivedAt: new Date() } });
  await assert.rejects(
    () => resumeReviewSchedule(seed.user.id, archivedSchedule.id, {
      expectedRevision: pausedArchivedSchedule.revision,
      dueDate,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "REVIEW_TARGET_ARCHIVED",
  );
  const unchangedPaused = await prisma.reviewSchedule.findUniqueOrThrow({ where: { id: archivedSchedule.id } });
  assert.equal(unchangedPaused.status, "PAUSED");
  assert.equal(unchangedPaused.revision, pausedArchivedSchedule.revision);
  await prisma.note.update({ where: { id: archivedTarget.id }, data: { archivedAt: null } });

  pass("schedule_constraints_pause_resume", {
    scheduleId: schedule.id,
    concurrentRescheduleSingleWinner: true,
    archivedTargetResumeRejected: true,
  });
}

async function verifyConfirmIdempotencyAndCheckIn(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const dueDate = getStudyDayRange().start.toISOString();
  const schedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "MISTAKE",
    mistakeId: seed.mistake.id,
    dueDate,
  });
  const key = `idem-${randomUUID()}`;
  const first = await confirmReviewEvent(seed.user.id, schedule.id, {
    idempotencyKey: key,
    expectedRevision: schedule.revision,
    result: "PASSED",
    durationSeconds: 320,
  });
  assert.equal(first.reused, false);
  assert.equal(first.event.durationSeconds, 320);

  const reused = await confirmReviewEvent(seed.user.id, schedule.id, {
    idempotencyKey: key,
    expectedRevision: schedule.revision,
    result: "PASSED",
    durationSeconds: 320,
  });
  assert.equal(reused.reused, true);
  assert.equal(reused.event.id, first.event.id);

  try {
    await confirmReviewEvent(seed.user.id, schedule.id, {
      idempotencyKey: key,
      expectedRevision: schedule.revision,
      result: "FAILED",
      durationSeconds: 320,
    });
    assert.fail("expected idempotency conflict");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "REVIEW_IDEMPOTENCY_CONFLICT");
    assert.equal(error.status, 409);
  }

  try {
    await confirmReviewEvent(seed.user.id, schedule.id, {
      idempotencyKey: `idem-${randomUUID()}`,
      expectedRevision: schedule.revision,
      result: "PARTIAL",
      durationSeconds: 60,
    });
    assert.fail("expected revision conflict");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "REVIEW_SCHEDULE_REVISION_CONFLICT");
  }

  const today = getStudyDayRange();
  const checkIns = await listWorkspaceCheckIns(seed.workspace.id, today.start, today.start);
  assert.equal(checkIns.length, 1);
  assert.equal(checkIns[0].sourceVersion, 2);
  assert.equal(checkIns[0].reviewSeconds, 320);
  assert.equal(checkIns[0].effectiveMinutes, 0);
  assert.equal(checkIns[0].minimumActionSource, "REVIEW");
  assert.equal(checkIns[0].completedMinimumAction, true);
  pass("confirm_idempotency_checkin_v2", {
    eventId: first.event.id,
    reviewSeconds: checkIns[0].reviewSeconds,
  });
}

async function verifyQuickReviewActivityExclusion(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const note = await prisma.note.create({
    data: {
      subjectId: seed.subject.id,
      title: "Quick review activity exclusion",
      content: "complete review target",
      kind: "CONCEPT",
    },
  });
  const schedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: note.id,
    dueDate: getStudyDayRange().start.toISOString(),
  });
  const command = {
    idempotencyKey: `quick-review-activity-${randomUUID()}`,
    expectedRevision: schedule.revision,
    result: "PARTIAL" as const,
    durationSeconds: 180,
    note: "activity exclusion",
  };
  const running = await startStudySession({ subjectId: seed.subject.id }, seed.user.id);
  await assert.rejects(
    () => confirmReviewEvent(seed.user.id, schedule.id, command),
    (error: unknown) => error instanceof ApiError
      && error.code === "ACTIVE_SESSION_BLOCKS_QUICK_REVIEW"
      && error.details?.workbench === `/focus/${running.id}`,
  );
  assert.equal(await prisma.reviewEvent.count({ where: { reviewScheduleId: schedule.id } }), 0);
  await prisma.studySession.update({
    where: { id: running.id },
    data: { status: "CANCELED", endedAt: new Date() },
  });

  const confirmed = await confirmReviewEvent(seed.user.id, schedule.id, command);
  assert.equal(confirmed.reused, false);
  const secondRunning = await startStudySession({ subjectId: seed.subject.id }, seed.user.id);
  const replay = await confirmReviewEvent(seed.user.id, schedule.id, command);
  assert.equal(replay.reused, true);
  assert.equal(replay.event.id, confirmed.event.id);
  assert.equal(await prisma.reviewEvent.count({ where: { reviewScheduleId: schedule.id } }), 1);
  await prisma.studySession.update({
    where: { id: secondRunning.id },
    data: { status: "CANCELED", endedAt: new Date() },
  });

  pass("quick_review_activity_exclusion", {
    activeSessionBlocked: true,
    idempotentReplayPrecedesActivityGate: true,
  });
}

async function verifyCorrectionSingleSuccessor(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const note2 = await prisma.note.create({
    data: {
      subjectId: seed.subject.id,
      title: "Correction note",
      content: "x",
      kind: "METHOD",
    },
  });
  const schedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: note2.id,
    dueDate: getStudyDayRange().start.toISOString(),
  });
  const confirmed = await confirmReviewEvent(seed.user.id, schedule.id, {
    idempotencyKey: `idem-${randomUUID()}`,
    expectedRevision: schedule.revision,
    result: "FAILED",
    durationSeconds: 90,
  });
  const correctionKey = `corr-${randomUUID()}`;
  const correctionInput = {
    idempotencyKey: correctionKey,
    expectedRevision: confirmed.schedule.revision,
    result: "PASSED" as const,
  };
  const correction = await correctReviewEvent(seed.user.id, confirmed.event.id, correctionInput);
  assert.equal(correction.event.correctedEventId, confirmed.event.id);
  assert.equal(correction.event.durationSeconds, 90);

  const correctionRetry = await correctReviewEvent(seed.user.id, confirmed.event.id, correctionInput);
  assert.equal(correctionRetry.reused, true);
  assert.equal(correctionRetry.event.id, correction.event.id);
  await assert.rejects(
    () => correctReviewEvent(seed.user.id, confirmed.event.id, {
      ...correctionInput,
      result: "PARTIAL",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "REVIEW_IDEMPOTENCY_CONFLICT",
  );

  try {
    await correctReviewEvent(seed.user.id, confirmed.event.id, {
      idempotencyKey: `corr-${randomUUID()}`,
      expectedRevision: correction.schedule.revision,
      result: "PARTIAL",
    });
    assert.fail("expected second correction to fail");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.ok(
      error.code === "REVIEW_CORRECTION_EXISTS" ||
        error.code === "REVIEW_EVENT_NOT_LATEST" ||
        error.code === "REVIEW_SCHEDULE_REVISION_CONFLICT",
    );
  }

  const concurrentNote = await prisma.note.create({
    data: { subjectId: seed.subject.id, title: "Concurrent correction note", content: "x", kind: "METHOD" },
  });
  const concurrentSchedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: concurrentNote.id,
    dueDate: getStudyDayRange().start.toISOString(),
  });
  const concurrentConfirmed = await confirmReviewEvent(seed.user.id, concurrentSchedule.id, {
    idempotencyKey: `confirm-${randomUUID()}`,
    expectedRevision: concurrentSchedule.revision,
    result: "FAILED",
    durationSeconds: 60,
  });
  const concurrentCorrectionInput = {
    idempotencyKey: `corr-concurrent-${randomUUID()}`,
    expectedRevision: concurrentConfirmed.schedule.revision,
    result: "PARTIAL" as const,
  };
  const concurrentCorrections = await Promise.all([
    correctReviewEvent(seed.user.id, concurrentConfirmed.event.id, concurrentCorrectionInput),
    correctReviewEvent(seed.user.id, concurrentConfirmed.event.id, concurrentCorrectionInput),
  ]);
  assert.equal(concurrentCorrections[0]?.event.id, concurrentCorrections[1]?.event.id);
  assert.equal(concurrentCorrections.filter((result) => result.reused).length, 1);
  assert.equal(await prisma.reviewEvent.count({ where: { correctedEventId: concurrentConfirmed.event.id } }), 1);

  const today = getStudyDayRange();
  const checkIns = await listWorkspaceCheckIns(seed.workspace.id, today.start, today.start);
  const row = checkIns[0];
  assert.ok(row);
  // correction replaces original: one effective event from first confirm (320) + this note's 90
  assert.ok(row.reviewSeconds >= 90);
  pass("correction_single_successor", {
    correctionId: correction.event.id,
    sequentialRetryReused: true,
    concurrentRetryReused: true,
    changedPayloadRejected: true,
  });
}

async function verifyBridgeAndInboxConvert(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const note3 = await prisma.note.create({
    data: {
      subjectId: seed.subject.id,
      title: "Bridge note",
      content: "x",
      kind: "EXAMPLE",
    },
  });
  const schedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: note3.id,
    dueDate: getStudyDayRange().start.toISOString(),
  });
  const bridge = await createBridgeTask(seed.user.id, {
    reviewScheduleId: schedule.id,
    subjectId: seed.subject.id,
    title: "Review bridge task",
  });
  assert.ok(bridge.taskId);

  try {
    await createBridgeTask(seed.user.id, {
      reviewScheduleId: schedule.id,
      subjectId: seed.subject.id,
      title: "Second bridge",
    });
    assert.fail("expected bridge unique conflict");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "REVIEW_BRIDGE_ALREADY_EXISTS");
  }

  const alternateSubject = await prisma.subject.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: `bridge-alt-${randomUUID()}`,
      name: "Bridge alternate",
      color: "#0f766e",
    },
  });
  const guardedNote = await prisma.note.create({
    data: { subjectId: seed.subject.id, title: "Guarded bridge note", content: "x", kind: "EXAMPLE" },
  });
  const guardedSchedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: guardedNote.id,
    dueDate: getStudyDayRange().start.toISOString(),
  });
  await assert.rejects(
    () => createBridgeTask(seed.user.id, {
      reviewScheduleId: guardedSchedule.id,
      subjectId: alternateSubject.id,
      title: "Cross-subject forged bridge",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "REVIEW_SCHEDULE_SUBJECT_MISMATCH",
  );
  const pausedGuardedSchedule = await pauseReviewSchedule(seed.user.id, guardedSchedule.id, {
    expectedRevision: guardedSchedule.revision,
    reason: "bridge guard",
  });
  await assert.rejects(
    () => createBridgeTask(seed.user.id, {
      reviewScheduleId: pausedGuardedSchedule.id,
      subjectId: seed.subject.id,
      title: "Paused forged bridge",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "REVIEW_SCHEDULE_NOT_BRIDGABLE",
  );

  const afterAbandon = await abandonBridgeTask(seed.user.id, bridge.taskId);
  assert.equal(afterAbandon.status, "ACTIVE");
  assert.ok(afterAbandon.dueDate);
  await assert.rejects(
    () => abandonBridgeTask(seed.user.id, bridge.taskId),
    (error: unknown) => error instanceof ApiError && error.code === "TASK_STATE_CONFLICT",
  );
  await assert.rejects(
    () => deferBridgeTask(seed.user.id, bridge.taskId, {
      expectedScheduleRevision: afterAbandon.revision,
      plannedDate: getStudyDayRange().start.toISOString(),
    }),
    (error: unknown) => error instanceof ApiError && error.code === "TASK_STATE_CONFLICT",
  );

  const completedNote = await prisma.note.create({
    data: { subjectId: seed.subject.id, title: "Completed bridge note", content: "x", kind: "EXAMPLE" },
  });
  const completedSchedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: completedNote.id,
    dueDate: getStudyDayRange().start.toISOString(),
  });
  const completedBridge = await createBridgeTask(seed.user.id, {
    reviewScheduleId: completedSchedule.id,
    subjectId: seed.subject.id,
    title: "Completed bridge",
  });
  const completedResult = await completeBridgeTaskWithReview(seed.user.id, completedBridge.taskId, {
    idempotencyKey: `bridge-complete-${randomUUID()}`,
    expectedRevision: completedSchedule.revision,
    result: "PASSED",
    durationSeconds: 120,
  });
  assert.equal((await prisma.studyTask.findUniqueOrThrow({ where: { id: completedBridge.taskId } })).status, "DONE");
  await assert.rejects(
    () => abandonBridgeTask(seed.user.id, completedBridge.taskId),
    (error: unknown) => error instanceof ApiError && error.code === "TASK_STATE_CONFLICT",
  );
  await assert.rejects(
    () => deferBridgeTask(seed.user.id, completedBridge.taskId, {
      expectedScheduleRevision: completedResult.schedule.revision,
      plannedDate: getStudyDayRange().start.toISOString(),
    }),
    (error: unknown) => error instanceof ApiError && error.code === "TASK_STATE_CONFLICT",
  );

  const primaryNode = await prisma.syllabusNode.create({
    data: { subjectId: seed.subject.id, title: "Inbox primary", kind: "TOPIC", stableKey: "inbox-primary" },
  });
  const relatedNode = await prisma.syllabusNode.create({
    data: { subjectId: seed.subject.id, title: "Inbox related", kind: "PROBLEM_TYPE", stableKey: "inbox-related" },
  });
  const predecessor = await prisma.studyTask.create({
    data: { subjectId: seed.subject.id, title: "Inbox predecessor", type: "focus", plannedDate: getStudyDayRange().start, estimatedMinutes: 20 },
  });
  const publicInput = {
    clientRequestKey: `public-inbox-${randomUUID()}`,
    title: "Public user-created inbox",
    subjectId: seed.subject.id,
    plannedDate: getStudyDayRange().start.toISOString(),
    estimatedMinutes: 20,
  };
  for (const [field, value] of Object.entries({
    originKey: "simulation-loss:forged",
    originVersion: 999,
    originType: "SIMULATION_LOSS",
    originSnapshot: { examId: "forged" },
  })) {
    assert.equal(planInboxClientCreateSchema.safeParse({ ...publicInput, [field]: value }).success, false);
  }
  const publicInbox = await createUserPlanInboxItem(seed.user.id, publicInput);
  assert.equal(publicInbox.originType, "USER_CREATED");
  assert.match(publicInbox.originKey, /^user-created:[a-f0-9]{64}$/);
  assert.deepEqual(publicInbox.originSnapshot, {
    provenanceVersion: 1,
    source: "USER_CREATED",
    clientRequestKeyHash: publicInbox.originKey.slice("user-created:".length),
  });
  const publicCreationAudit = await prisma.auditEvent.findFirstOrThrow({
    where: { action: "PLAN_INBOX_CREATED", entityType: "PlanInboxItem", entityId: publicInbox.id },
    select: { metadata: true },
  });
  const publicAuditText = JSON.stringify(publicCreationAudit.metadata);
  assert.equal(publicAuditText.includes(publicInput.title), false);
  assert.equal(publicAuditText.includes("inputFingerprint"), false);

  const reviewInbox = await createPlanInboxItem(seed.user.id, {
    stableKey: `review-due-${afterAbandon.id}`,
    originKey: `review-due-${afterAbandon.id}`,
    originVersion: afterAbandon.revision,
    originType: "REVIEW_DUE",
    originSnapshot: {
      reviewScheduleId: afterAbandon.id,
      reviewScheduleRevision: afterAbandon.revision,
      dueDate: afterAbandon.dueDate,
    },
    title: "Trusted review due inbox",
    subjectId: seed.subject.id,
    plannedDate: afterAbandon.dueDate,
    estimatedMinutes: 25,
    type: "review",
  });
  const convertedReviewInbox = await convertPlanInboxItem(seed.user.id, reviewInbox.id, {
    expectedRevision: reviewInbox.revision,
    idempotencyKey: `review-due-convert-${randomUUID()}`,
  });
  assert.ok(convertedReviewInbox.convertedTaskId);
  assert.equal((await prisma.studyTask.findUniqueOrThrow({
    where: { id: convertedReviewInbox.convertedTaskId! },
    select: { reviewScheduleId: true },
  })).reviewScheduleId, afterAbandon.id);
  const incompleteReviewInbox = await createPlanInboxItem(seed.user.id, {
    stableKey: `review-due-incomplete-${randomUUID()}`,
    originKey: `review-due-incomplete-${randomUUID()}`,
    originVersion: 1,
    originType: "REVIEW_DUE",
    originSnapshot: { reviewScheduleId: afterAbandon.id },
    title: "Incomplete review due inbox",
    subjectId: seed.subject.id,
    plannedDate: afterAbandon.dueDate,
    estimatedMinutes: 25,
    type: "review",
  });
  await assert.rejects(
    () => convertPlanInboxItem(seed.user.id, incompleteReviewInbox.id, {
      expectedRevision: incompleteReviewInbox.revision,
      idempotencyKey: `review-due-incomplete-${randomUUID()}`,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "PLAN_INBOX_ORIGIN_STALE",
  );
  const inbox = await createPlanInboxItem(seed.user.id, {
    stableKey: `inbox-${randomUUID()}`,
    originKey: `origin-${randomUUID()}`,
    originVersion: 1,
    originType: "DAILY_REVIEW",
    originSnapshot: { source: "selftest" },
    title: "Tomorrow minimum",
    subjectId: seed.subject.id,
    plannedDate: getStudyDayRange().start.toISOString(),
    estimatedMinutes: 30,
    type: "focus",
    primaryNodeId: primaryNode.id,
    relatedNodeIds: [relatedNode.id],
    predecessorTasks: [{ taskId: predecessor.id, dependencyType: "HARD" }],
  });
  const conversionKey = `inbox-convert-${randomUUID()}`;
  const converted = await convertPlanInboxItem(seed.user.id, inbox.id, {
    expectedRevision: inbox.revision,
    idempotencyKey: conversionKey,
  });
  assert.equal(converted.status, "CONVERTED");
  assert.ok(converted.convertedTaskId);

  const reused = await convertPlanInboxItem(seed.user.id, inbox.id, {
    expectedRevision: inbox.revision,
    idempotencyKey: conversionKey,
  });
  assert.equal(reused.convertedTaskId, converted.convertedTaskId);
  assert.equal(await prisma.studyTask.count({ where: { id: converted.convertedTaskId ?? "" } }), 1);
  assert.equal(await prisma.studyTaskRelatedSyllabusNode.count({ where: { taskId: converted.convertedTaskId ?? "", syllabusNodeId: relatedNode.id } }), 1);
  assert.equal(await prisma.taskDependency.count({ where: { predecessorId: predecessor.id, successorId: converted.convertedTaskId ?? "", type: "HARD" } }), 1);

  assert.equal(planInboxConvertSchema.safeParse({
    expectedRevision: inbox.revision,
    idempotencyKey: conversionKey,
    reviewScheduleId: schedule.id,
  }).success, false);

  await assert.rejects(
    () => convertPlanInboxItem(seed.user.id, inbox.id, { expectedRevision: converted.revision, idempotencyKey: `different-${randomUUID()}` }),
    (error: unknown) => error instanceof ApiError && error.code === "PLAN_INBOX_ALREADY_CONVERTED",
  );

  const concurrentInbox = await createPlanInboxItem(seed.user.id, {
    stableKey: `concurrent-${randomUUID()}`,
    originKey: `concurrent-${randomUUID()}`,
    originVersion: 1,
    originType: "SELFTEST",
    originSnapshot: { source: "selftest", sourceStableKey: "source-plan" },
    title: "Concurrent conversion",
    subjectId: seed.subject.id,
    plannedDate: getStudyDayRange().start.toISOString(),
    estimatedMinutes: 25,
  });
  assert.equal(matchesPlanInboxStableRef(concurrentInbox, "source-plan@1"), true);
  const concurrentKey = `concurrent-convert-${randomUUID()}`;
  const concurrentConverted = await Promise.all([
    convertPlanInboxItem(seed.user.id, concurrentInbox.id, {
      expectedRevision: concurrentInbox.revision,
      idempotencyKey: concurrentKey,
    }),
    convertPlanInboxItem(seed.user.id, concurrentInbox.id, {
      expectedRevision: concurrentInbox.revision,
      idempotencyKey: concurrentKey,
    }),
  ]);
  assert.equal(concurrentConverted[0]?.convertedTaskId, concurrentConverted[1]?.convertedTaskId);
  assert.equal(await prisma.studyTask.count({ where: { id: concurrentConverted[0]?.convertedTaskId ?? "" } }), 1);

  const racingInbox = await createPlanInboxItem(seed.user.id, {
    stableKey: `transition-race-${randomUUID()}`,
    originKey: `transition-race-${randomUUID()}`,
    originVersion: 1,
    originType: "SELFTEST",
    originSnapshot: { source: "selftest" },
    title: "Transition race",
    subjectId: seed.subject.id,
    plannedDate: getStudyDayRange().start.toISOString(),
    estimatedMinutes: 20,
  });
  const transitionRace = await Promise.allSettled([
    convertPlanInboxItem(seed.user.id, racingInbox.id, {
      expectedRevision: racingInbox.revision,
      idempotencyKey: `transition-race-${randomUUID()}`,
    }),
    dismissPlanInboxItem(seed.user.id, racingInbox.id, racingInbox.revision),
  ]);
  assert.equal(transitionRace.filter((result) => result.status === "fulfilled").length, 1);
  const racedState = await prisma.planInboxItem.findUniqueOrThrow({ where: { id: racingInbox.id } });
  assert.equal(racedState.status === "CONVERTED" || racedState.status === "DISMISSED", true);
  assert.equal(Boolean(racedState.convertedTaskId), racedState.status === "CONVERTED");

  const incomplete = await createPlanInboxItem(seed.user.id, {
    stableKey: `incomplete-${randomUUID()}`,
    originKey: `incomplete-${randomUUID()}`,
    originVersion: 1,
    originType: "SELFTEST",
    originSnapshot: { source: "selftest" },
    title: "Incomplete item",
    subjectId: seed.subject.id,
  });
  await assert.rejects(
    () => convertPlanInboxItem(seed.user.id, incomplete.id, { expectedRevision: incomplete.revision, idempotencyKey: `incomplete-${randomUUID()}` }),
    (error: unknown) => error instanceof ApiError && error.code === "PLAN_INBOX_INCOMPLETE",
  );

  const unresolved = await createPlanInboxItem(seed.user.id, {
    stableKey: `unresolved-${randomUUID()}`,
    originKey: `unresolved-${randomUUID()}`,
    originVersion: 1,
    originType: "SELFTEST",
    originSnapshot: { source: "selftest" },
    title: "Unresolved dependency",
    subjectId: seed.subject.id,
    plannedDate: getStudyDayRange().start.toISOString(),
    estimatedMinutes: 25,
  });
  await prisma.planInboxDependencyRef.create({
    data: { inboxItemId: unresolved.id, targetType: "INBOX_STABLE_REF", dependencyType: "SOFT", planStableKey: "missing-plan", planOriginVersion: 1 },
  });
  await assert.rejects(
    () => convertPlanInboxItem(seed.user.id, unresolved.id, { expectedRevision: unresolved.revision, idempotencyKey: `unresolved-${randomUUID()}` }),
    (error: unknown) => error instanceof ApiError && error.code === "PLAN_INBOX_DEPENDENCY_UNRESOLVED",
  );
  assert.equal(await prisma.studyTask.count({ where: { title: "Unresolved dependency" } }), 0);

  pass("bridge_and_inbox_convert", {
    abandonedScheduleId: afterAbandon.id,
    convertedTaskId: converted.convertedTaskId ?? "",
    dependencyCount: 1,
    relatedNodeCount: 1,
    concurrentConvertReused: true,
    transitionRaceAtomic: true,
    stableRefMatched: true,
    clientProvenanceSpoofRejected: true,
    clientProvenanceRebuilt: true,
    reviewDueSnapshotRequired: true,
    auditContentRedacted: true,
  });
}

async function verifyBridgeWorkspaceSwitchBoundary(): Promise<void> {
  const user = await prisma.user.create({
    data: { email: `v11m6-switch-${randomUUID()}@example.com`, passwordHash: "x" },
  });
  const oldWorkspace = await prisma.examWorkspace.create({
    data: {
      userId: user.id,
      stableKey: `m6-old-${randomUUID()}`,
      name: "M6 Old Workspace",
      status: "ACTIVE",
    },
  });
  const oldSubject = await prisma.subject.create({
    data: {
      workspaceId: oldWorkspace.id,
      stableKey: `m6-old-subject-${randomUUID()}`,
      name: "M6 Old Subject",
      color: "#111111",
    },
  });
  const reviewNote = await prisma.note.create({
    data: { subjectId: oldSubject.id, title: "Historical review writes", content: "x", kind: "EXAMPLE" },
  });
  const reviewSchedule = await materializeReviewSchedule(user.id, {
    targetType: "NOTE",
    noteId: reviewNote.id,
    dueDate: getStudyDayRange().start.toISOString(),
  });
  const confirmedReview = await confirmReviewEvent(user.id, reviewSchedule.id, {
    idempotencyKey: `historical-confirm-${randomUUID()}`,
    expectedRevision: reviewSchedule.revision,
    result: "FAILED",
    durationSeconds: 60,
  });
  const historicalBridges = await Promise.all(
    ["complete", "defer", "abandon"].map(async (operation) => {
      const note = await prisma.note.create({
        data: { subjectId: oldSubject.id, title: `Historical ${operation} bridge`, content: "x", kind: "EXAMPLE" },
      });
      const reviewSchedule = await materializeReviewSchedule(user.id, {
        targetType: "NOTE",
        noteId: note.id,
        dueDate: getStudyDayRange().start.toISOString(),
      });
      const bridgeTask = await createBridgeTask(user.id, {
        reviewScheduleId: reviewSchedule.id,
        subjectId: oldSubject.id,
        title: `Historical ${operation} task`,
      });
      return { operation, reviewSchedule, bridgeTask };
    }),
  );
  const nextWorkspace = await prisma.examWorkspace.create({
    data: {
      userId: user.id,
      stableKey: `m6-next-${randomUUID()}`,
      name: "M6 Next Workspace",
      status: "ARCHIVED",
    },
  });
  await prisma.subject.create({
    data: {
      workspaceId: nextWorkspace.id,
      stableKey: `m6-next-subject-${randomUUID()}`,
      name: "M6 Next Subject",
      color: "#0f766e",
    },
  });
  await activateExamWorkspace(user.id, nextWorkspace.id, nextWorkspace.revision);

  const switchedSchedule = await prisma.reviewSchedule.findUniqueOrThrow({ where: { id: reviewSchedule.id } });
  const switchedEventCount = await prisma.reviewEvent.count({ where: { reviewScheduleId: reviewSchedule.id } });
  await assert.rejects(
    () => materializeReviewSchedule(user.id, {
      targetType: "NOTE",
      noteId: reviewNote.id,
      dueDate: getStudyDayRange().start.toISOString(),
    }),
    (error: unknown) => error instanceof ApiError && error.code === "REVIEW_TARGET_NOT_FOUND",
  );
  await assert.rejects(
    () => rescheduleReview(user.id, reviewSchedule.id, {
      expectedRevision: switchedSchedule.revision,
      dueDate: getStudyDayRange().start.toISOString(),
    }),
    (error: unknown) => error instanceof ApiError && error.code === "REVIEW_SCHEDULE_NOT_FOUND",
  );
  await assert.rejects(
    () => pauseReviewSchedule(user.id, reviewSchedule.id, {
      expectedRevision: switchedSchedule.revision,
      reason: "blocked historical pause",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "REVIEW_SCHEDULE_NOT_FOUND",
  );
  await assert.rejects(
    () => resumeReviewSchedule(user.id, reviewSchedule.id, {
      expectedRevision: switchedSchedule.revision,
      dueDate: getStudyDayRange().start.toISOString(),
    }),
    (error: unknown) => error instanceof ApiError && error.code === "REVIEW_SCHEDULE_NOT_FOUND",
  );
  await assert.rejects(
    () => correctReviewEvent(user.id, confirmedReview.event.id, {
      idempotencyKey: `historical-correct-${randomUUID()}`,
      expectedRevision: switchedSchedule.revision,
      result: "PASSED",
    }),
    (error: unknown) => error instanceof ApiError && error.code === "REVIEW_EVENT_NOT_FOUND",
  );

  const completeHistorical = historicalBridges.find((item) => item.operation === "complete")!;
  const deferHistorical = historicalBridges.find((item) => item.operation === "defer")!;
  const abandonHistorical = historicalBridges.find((item) => item.operation === "abandon")!;
  await assert.rejects(
    () => completeBridgeTaskWithReview(user.id, completeHistorical.bridgeTask.taskId, {
      idempotencyKey: `historical-complete-${randomUUID()}`,
      expectedRevision: completeHistorical.reviewSchedule.revision,
      result: "PASSED",
      durationSeconds: 60,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "STUDY_TASK_NOT_FOUND",
  );
  await assert.rejects(
    () => deferBridgeTask(user.id, deferHistorical.bridgeTask.taskId, {
      expectedScheduleRevision: deferHistorical.reviewSchedule.revision,
      plannedDate: getStudyDayRange().start.toISOString(),
    }),
    (error: unknown) => error instanceof ApiError && error.code === "STUDY_TASK_NOT_FOUND",
  );
  await assert.rejects(
    () => abandonBridgeTask(user.id, abandonHistorical.bridgeTask.taskId),
    (error: unknown) => error instanceof ApiError && error.code === "STUDY_TASK_NOT_FOUND",
  );
  const historicalTaskRows = await prisma.studyTask.findMany({
    where: { id: { in: historicalBridges.map((item) => item.bridgeTask.taskId) } },
    select: { status: true },
  });
  assert.equal(historicalTaskRows.length, 3);
  assert.ok(historicalTaskRows.every((task) => task.status === "TODO"));
  assert.equal(await prisma.reviewEvent.count({
    where: { reviewScheduleId: { in: historicalBridges.map((item) => item.reviewSchedule.id) } },
  }), 0);
  assert.deepEqual(
    await prisma.reviewSchedule.findUniqueOrThrow({ where: { id: reviewSchedule.id } }),
    switchedSchedule,
  );
  assert.equal(await prisma.reviewEvent.count({ where: { reviewScheduleId: reviewSchedule.id } }), switchedEventCount);
  pass("bridge_workspace_switch_boundary", {
    historicalTasks: historicalTaskRows.length,
    rejectedWrites: 8,
  });
}

async function verifyTrustedInboxAdoptions(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const proofSecret = ["v11", "m6", "isolated", "result", "proof", "fixture", "20260726"].join("-");
  process.env.AI_PAYLOAD_BINDING_SECRET = proofSecret;
  const operationId = randomUUID();
  const operation = await prisma.aiDraftOperation.create({
    data: {
      operationId,
      actorId: seed.user.id,
      workspaceId: seed.workspace.id,
      endpoint: "plan",
      purpose: "preview:v1",
      requestFingerprint: "m6-ai-plan-request-fingerprint",
      nonce: randomUUID(),
      projectionVersion: "plan-projection-v1",
      status: "SUCCEEDED",
      resultReference: `draft:plan:${operationId}:local_rule_fallback`,
      expiresAt: new Date(Date.now() + 60_000),
      revision: 3,
    },
  });
  const proofDraft = {
    status: "local_rule_fallback" as const,
    schemaVersion: "plan-draft-v1" as const,
    title: "AI trusted plan",
    tasks: [{ title: "AI trusted plan item", estimatedMinutes: 25 }],
    reason: "M6 isolated result proof fixture.",
  };
  const resultProof = mintAiDraftResultProof({
    actorId: seed.user.id,
    workspaceId: seed.workspace.id,
    endpoint: "plan",
    operationId,
    projectionVersion: operation.projectionVersion,
    outputSchema: "plan-draft-v1",
    status: proofDraft.status,
    externalCall: false,
    draft: proofDraft,
    meta: { reason: "isolated fallback", sensitiveContextIncluded: false },
  }, proofSecret).token;
  const aiInput = {
    operationId,
    projectionVersion: operation.projectionVersion,
    resultProof,
    tasks: [{
      title: "AI trusted plan item",
      plannedDate: getStudyDayRange().start.toISOString(),
      estimatedMinutes: 25,
    }],
  };
  const [aiItem] = await adoptAiPlanDraftToInbox(seed.user.id, aiInput);
  assert.ok(aiItem);
  assert.equal(aiItem.originType, "AI_PLAN");
  assert.equal((aiItem.originSnapshot as { operationId?: string }).operationId, operationId);
  assert.equal(JSON.stringify(aiItem.originSnapshot).includes(resultProof), false);
  const acknowledgedOperation = await prisma.aiDraftOperation.findUniqueOrThrow({ where: { id: operation.id } });
  assert.equal(acknowledgedOperation.status, "SUCCEEDED");
  assert.equal(acknowledgedOperation.revision, 4);
  assert.ok(acknowledgedOperation.consumedAt);
  const editedAiItem = await updatePlanInboxItem(seed.user.id, aiItem.id, {
    expectedRevision: aiItem.revision,
    title: "AI item edited by user",
  });
  const [retriedAiItem] = await adoptAiPlanDraftToInbox(seed.user.id, aiInput);
  assert.equal(retriedAiItem?.id, editedAiItem.id);
  assert.equal(retriedAiItem?.title, "AI item edited by user");
  await assert.rejects(
    () => adoptAiPlanDraftToInbox(seed.user.id, {
      ...aiInput,
      tasks: [{ ...aiInput.tasks[0], title: "forged task under a valid operation" }],
    }),
    (error: unknown) => error instanceof ApiError && error.code === "AI_DRAFT_RESULT_MISMATCH",
  );
  const tamperedProof = `${resultProof.slice(0, -1)}${resultProof.endsWith("A") ? "B" : "A"}`;
  await assert.rejects(
    () => adoptAiPlanDraftToInbox(seed.user.id, { ...aiInput, resultProof: tamperedProof }),
    (error: unknown) => error instanceof ApiError && error.code === "AI_DRAFT_RESULT_PROOF_INVALID",
  );
  await assert.rejects(
    () => adoptAiPlanDraftToInbox(seed.user.id, { ...aiInput, operationId: randomUUID() }),
    (error: unknown) => error instanceof ApiError && error.code === "AI_DRAFT_RESULT_PROOF_INVALID",
  );

  const endedAt = getStudyDayRange().start;
  const lowConversionSession = await prisma.studySession.create({
    data: {
      subjectId: seed.subject.id,
      status: "COMPLETED",
      startedAt: new Date(endedAt.getTime() - 25 * 60_000),
      endedAt,
      effectiveMinutes: 25,
      isEffective: false,
      isLowConversion: true,
      requiredOutput: "补一条可复核产出",
      closeoutVersion: 2,
    },
  });
  const lowItem = await createLowConversionPlanInboxItem(seed.user.id, {
    sessionId: lowConversionSession.id,
    expectedCloseoutVersion: lowConversionSession.closeoutVersion,
  });
  assert.equal(lowItem.originType, "LOW_CONVERSION");
  assert.equal((lowItem.originSnapshot as { sessionId?: string }).sessionId, lowConversionSession.id);
  const editedLowItem = await updatePlanInboxItem(seed.user.id, lowItem.id, {
    expectedRevision: lowItem.revision,
    title: "用户修改后的低转化补救",
  });
  const retriedLowItem = await createLowConversionPlanInboxItem(seed.user.id, {
    sessionId: lowConversionSession.id,
    expectedCloseoutVersion: lowConversionSession.closeoutVersion,
  });
  assert.equal(retriedLowItem.id, editedLowItem.id);
  assert.equal(retriedLowItem.title, "用户修改后的低转化补救");
  const lowRetargetSubject = await prisma.subject.create({
    data: {
      workspaceId: seed.workspace.id,
      stableKey: `low-retarget-${randomUUID()}`,
      name: "Low conversion retarget",
      color: "#2563eb",
    },
  });
  const retargetedLowItem = await updatePlanInboxItem(seed.user.id, editedLowItem.id, {
    expectedRevision: editedLowItem.revision,
    subjectId: lowRetargetSubject.id,
    primaryNodeId: null,
    relatedNodeIds: [],
  });
  await prisma.subject.update({ where: { id: seed.subject.id }, data: { archivedAt: new Date() } });
  await assert.rejects(
    () => convertPlanInboxItem(seed.user.id, retargetedLowItem.id, {
      expectedRevision: retargetedLowItem.revision,
      idempotencyKey: `low-archived-source-${randomUUID()}`,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "PLAN_INBOX_ORIGIN_ARCHIVED",
  );
  await prisma.subject.update({ where: { id: seed.subject.id }, data: { archivedAt: null } });
  await assert.rejects(
    () => createLowConversionPlanInboxItem(seed.user.id, {
      sessionId: lowConversionSession.id,
      expectedCloseoutVersion: 1,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "LOW_CONVERSION_SOURCE_STALE",
  );

  const ordinarySession = await prisma.studySession.create({
    data: {
      subjectId: seed.subject.id,
      status: "COMPLETED",
      startedAt: new Date(endedAt.getTime() - 15 * 60_000),
      endedAt,
      effectiveMinutes: 15,
      isEffective: true,
      isLowConversion: false,
    },
  });
  await assert.rejects(
    () => createLowConversionPlanInboxItem(seed.user.id, {
      sessionId: ordinarySession.id,
      expectedCloseoutVersion: ordinarySession.closeoutVersion,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "LOW_CONVERSION_SOURCE_INVALID",
  );

  pass("trusted_inbox_adoptions", {
    aiOriginRebuilt: true,
    aiResultProofBound: true,
    aiRetryAfterEditReused: true,
    forgedAiTasksRejected: true,
    tamperedAiProofRejected: true,
    lowConversionOriginRebuilt: true,
    lowConversionRetryAfterEditReused: true,
    forgedOperationRejected: true,
  });
}

async function verifyRecoveryStages(seed: Awaited<ReturnType<typeof seedWorkspace>>): Promise<void> {
  const started = await startRecoveryV2(seed.user.id, { reason: "selftest" });
  assert.equal(started.status, "ACTIVE");
  assert.equal(started.currentStage, 1);
  assert.equal(started.targetMinutes, 30);

  const again = await startRecoveryV2(seed.user.id);
  assert.equal(again.id, started.id);

  const advanced = await applyRecoveryDayProgress(seed.user.id, { progressMinutesToday: 30 });
  assert.ok(advanced);
  assert.equal(advanced.currentStage, 2);
  assert.equal(advanced.status, "ACTIVE");

  const noDouble = await applyRecoveryDayProgress(seed.user.id, { progressMinutesToday: 90 });
  assert.ok(noDouble);
  assert.equal(noDouble.currentStage, 2);

  await prisma.recoveryState.update({
    where: { id: noDouble.id },
    data: { lastProgressDate: new Date(getStudyDayRange().start.getTime() - 24 * 60 * 60 * 1000) },
  });
  const stageThree = await applyRecoveryDayProgress(seed.user.id, { progressMinutesToday: 60 });
  assert.ok(stageThree);
  assert.equal(stageThree.currentStage, 3);
  assert.equal(stageThree.status, "ACTIVE");

  await prisma.recoveryState.update({
    where: { id: stageThree.id },
    data: { lastProgressDate: new Date(getStudyDayRange().start.getTime() - 24 * 60 * 60 * 1000) },
  });
  const completed = await applyRecoveryDayProgress(seed.user.id, { progressMinutesToday: 90 });
  assert.ok(completed);
  assert.equal(completed.currentStage, 3);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(await getActiveRecoveryV2(seed.user.id), null);

  const reviewRecovery = await startRecoveryV2(seed.user.id, { reason: "review production hook" });
  const recoveryNote = await prisma.note.create({
    data: {
      subjectId: seed.subject.id,
      title: "Recovery review hook",
      content: "review hook",
      kind: "CONCEPT",
    },
  });
  const recoverySchedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: recoveryNote.id,
    dueDate: getStudyDayRange().start.toISOString(),
  });
  await confirmReviewEvent(seed.user.id, recoverySchedule.id, {
    idempotencyKey: `recovery-review-${randomUUID()}`,
    expectedRevision: recoverySchedule.revision,
    result: "PARTIAL",
    durationSeconds: 1800,
  });
  const afterReview = await getActiveRecoveryV2(seed.user.id);
  assert.ok(afterReview);
  assert.equal(afterReview.id, reviewRecovery.id);
  assert.equal(afterReview.currentStage, 2);
  await cancelRecoveryV2(seed.user.id, afterReview.id, { expectedRevision: afterReview.revision });

  const sessionRecovery = await startRecoveryV2(seed.user.id, { reason: "session production hook" });
  const running = await startStudySession({ subjectId: seed.subject.id }, seed.user.id);
  await prisma.studySession.update({
    where: { id: running.id },
    data: { startedAt: new Date(Date.now() - 31 * 60_000) },
  });
  const sessionPreimage = await prisma.studySession.findUniqueOrThrow({ where: { id: running.id } });
  const closing = await endStudySession(running.id, {
    mode: "prepare",
    expectedStatus: "running",
    expectedUpdatedAt: sessionPreimage.updatedAt.toISOString(),
    idempotencyKey: `recovery-session-${running.id}:prepare`,
    producedNote: false,
    producedMistake: false,
    completeTask: false,
  }, seed.user.id);
  await endStudySession(running.id, {
    expectedStatus: "closing",
    expectedUpdatedAt: closing.updatedAt,
    idempotencyKey: `recovery-session-${running.id}:complete`,
    qualityScore: 4,
    isEffective: true,
    understandingLevel: "清晰",
    minimalOutput: "完成 Recovery 生产推进链路核验。",
    nextAction: "继续下一阶",
    producedNote: true,
    producedMistake: false,
    completeTask: false,
  }, seed.user.id);
  const afterSession = await getActiveRecoveryV2(seed.user.id);
  assert.ok(afterSession);
  assert.equal(afterSession.id, sessionRecovery.id);
  assert.equal(afterSession.currentStage, 2);
  await cancelRecoveryV2(seed.user.id, afterSession.id, { expectedRevision: afterSession.revision });

  const expiring = await startRecoveryV2(seed.user.id, { reason: "expiry read hook" });
  const sevenDaysAgo = new Date(getStudyDayRange().start.getTime() - 7 * 24 * 60 * 60 * 1000);
  const stale = await prisma.recoveryState.update({
    where: { id: expiring.id },
    data: {
      windowStartDate: sevenDaysAgo,
      windowEndDate: getStudyDayRange().start,
      revision: { increment: 1 },
    },
  });
  const expiredProjection = await getActiveRecoveryV2(seed.user.id);
  assert.ok(expiredProjection);
  assert.equal(expiredProjection.effectiveStatus, "EXPIRED");
  assert.equal(expiredProjection.restartAvailable, true);
  const projectedExpired = await prisma.recoveryState.findUniqueOrThrow({ where: { id: stale.id } });
  assert.equal(projectedExpired.status, "ACTIVE");
  const restarted = await restartRecoveryV2(seed.user.id, projectedExpired.id, {
    expectedRevision: projectedExpired.revision,
  });
  const expired = await prisma.recoveryState.findUniqueOrThrow({ where: { id: projectedExpired.id } });
  assert.equal(expired.status, "EXPIRED");
  assert.equal(restarted.status, "ACTIVE");
  assert.notEqual(restarted.id, expired.id);
  await cancelRecoveryV2(seed.user.id, restarted.id, { expectedRevision: restarted.revision });

  pass("recovery_stages_and_production_hooks", {
    completedId: completed.id,
    reviewRecoveryId: reviewRecovery.id,
    sessionRecoveryId: sessionRecovery.id,
    expiredId: expired.id,
    restartedId: restarted.id,
  });
}

async function verifyHardConcurrencyFixtures(
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
): Promise<void> {
  const dueDate = getStudyDayRange().start.toISOString();

  // 1) 零时长拒绝
  const zeroNote = await prisma.note.create({
    data: {
      subjectId: seed.subject.id,
      title: "Zero duration note",
      content: "x",
      kind: "CONCEPT",
    },
  });
  const zeroSchedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: zeroNote.id,
    dueDate,
  });
  try {
    await confirmReviewEvent(seed.user.id, zeroSchedule.id, {
      idempotencyKey: `zero-${randomUUID()}`,
      expectedRevision: zeroSchedule.revision,
      result: "PASSED",
      durationSeconds: 0,
    });
    assert.fail("expected zero duration rejection");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "REVIEW_INVALID_DURATION");
    assert.equal(error.status, 400);
  }
  pass("zero_duration_rejected", { scheduleId: zeroSchedule.id });

  // 2) Event 不可变 + 3) correction CAS stale revision
  const immNote = await prisma.note.create({
    data: {
      subjectId: seed.subject.id,
      title: "Immutable event note",
      content: "x",
      kind: "METHOD",
    },
  });
  const immSchedule = await materializeReviewSchedule(seed.user.id, {
    targetType: "NOTE",
    noteId: immNote.id,
    dueDate,
  });
  const originalConfirm = await confirmReviewEvent(seed.user.id, immSchedule.id, {
    idempotencyKey: `imm-${randomUUID()}`,
    expectedRevision: immSchedule.revision,
    result: "FAILED",
    durationSeconds: 120,
  });
  const originalBefore = await prisma.reviewEvent.findUniqueOrThrow({
    where: { id: originalConfirm.event.id },
  });

  try {
    await correctReviewEvent(seed.user.id, originalConfirm.event.id, {
      idempotencyKey: `stale-corr-${randomUUID()}`,
      expectedRevision: originalConfirm.schedule.revision - 1,
      result: "PASSED",
    });
    assert.fail("expected stale correction CAS conflict");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "REVIEW_SCHEDULE_REVISION_CONFLICT");
    assert.equal(error.status, 409);
  }
  pass("correction_cas_stale_revision", { eventId: originalConfirm.event.id });

  const correction = await correctReviewEvent(seed.user.id, originalConfirm.event.id, {
    idempotencyKey: `imm-corr-${randomUUID()}`,
    expectedRevision: originalConfirm.schedule.revision,
    result: "PASSED",
  });
  const originalAfter = await prisma.reviewEvent.findUniqueOrThrow({
    where: { id: originalConfirm.event.id },
  });
  assert.equal(originalAfter.result, originalBefore.result);
  assert.equal(originalAfter.durationSeconds, originalBefore.durationSeconds);
  assert.equal(originalAfter.result, "FAILED");
  assert.equal(originalAfter.durationSeconds, 120);
  assert.equal(correction.event.correctedEventId, originalConfirm.event.id);
  assert.equal(correction.event.result, "PASSED");
  assert.equal(correction.event.durationSeconds, 120);
  pass("event_immutable_after_correction", {
    originalId: originalConfirm.event.id,
    correctionId: correction.event.id,
  });

  // 4) CheckIn sourceVersion 1→2 触达升级
  await resetTables();
  const upgradeSeed = await seedWorkspace();
  const upgradeDay = getStudyDayRange().start;
  await prisma.checkIn.create({
    data: {
      workspaceId: upgradeSeed.workspace.id,
      studyDate: upgradeDay,
      sourceVersion: 1,
      completedMinimumAction: false,
      totalMinutes: 0,
      effectiveMinutes: 0,
      effectiveSessionCount: 0,
      taskCompletionRate: 0,
      reviewSubmitted: false,
      lowEfficiency: true,
      lowConversionCount: 0,
      reviewCount: 0,
      reviewSeconds: 0,
      passedCount: 0,
      partialCount: 0,
      failedCount: 0,
      minimumActionSource: "NONE",
    },
  });
  const upgradeNote = await prisma.note.create({
    data: {
      subjectId: upgradeSeed.subject.id,
      title: "Upgrade checkin note",
      content: "x",
      kind: "EXAMPLE",
    },
  });
  const upgradeSchedule = await materializeReviewSchedule(upgradeSeed.user.id, {
    targetType: "NOTE",
    noteId: upgradeNote.id,
    dueDate: upgradeDay.toISOString(),
  });
  await confirmReviewEvent(upgradeSeed.user.id, upgradeSchedule.id, {
    idempotencyKey: `upgrade-${randomUUID()}`,
    expectedRevision: upgradeSchedule.revision,
    result: "PASSED",
    durationSeconds: 300,
  });
  const upgraded = await listWorkspaceCheckIns(upgradeSeed.workspace.id, upgradeDay, upgradeDay);
  assert.equal(upgraded.length, 1);
  assert.equal(upgraded[0].sourceVersion, 2);
  assert.equal(upgraded[0].reviewCount, 1);
  assert.equal(upgraded[0].reviewSeconds, 300);
  assert.equal(upgraded[0].passedCount, 1);
  assert.equal(upgraded[0].minimumActionSource, "REVIEW");
  pass("checkin_source_version_upgrade", {
    sourceVersion: upgraded[0].sourceVersion,
    reviewSeconds: upgraded[0].reviewSeconds,
  });

  // 5) 桥接完成必须有 ReviewEvent.result；普通 complete 拒绝
  const bridgeNote = await prisma.note.create({
    data: {
      subjectId: upgradeSeed.subject.id,
      title: "Bridge complete note",
      content: "x",
      kind: "CONCEPT",
    },
  });
  const bridgeSchedule = await materializeReviewSchedule(upgradeSeed.user.id, {
    targetType: "NOTE",
    noteId: bridgeNote.id,
    dueDate: upgradeDay.toISOString(),
  });
  const bridge = await createBridgeTask(upgradeSeed.user.id, {
    reviewScheduleId: bridgeSchedule.id,
    subjectId: upgradeSeed.subject.id,
    title: "Bridge complete task",
  });

  try {
    await completeStudyTask(bridge.taskId, undefined, upgradeSeed.user.id);
    assert.fail("expected plain complete to reject bridge task");
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "REVIEW_BRIDGE_COMPLETE_REQUIRES_RESULT");
    assert.equal(error.status, 409);
  }

  const completionInput = {
    idempotencyKey: `bridge-done-${randomUUID()}`,
    expectedRevision: bridgeSchedule.revision,
    result: "PARTIAL",
    durationSeconds: 180,
  } as const;
  const completed = await completeBridgeTaskWithReview(upgradeSeed.user.id, bridge.taskId, completionInput);
  assert.equal(completed.event.result, "PARTIAL");
  assert.equal(completed.event.durationSeconds, 180);
  assert.ok(completed.event.id);
  const doneTask = await prisma.studyTask.findUniqueOrThrow({ where: { id: bridge.taskId } });
  assert.equal(doneTask.status, "DONE");
  const persistedEvent = await prisma.reviewEvent.findUniqueOrThrow({
    where: { id: completed.event.id },
  });
  assert.equal(persistedEvent.result, "PARTIAL");
  const replayed = await completeBridgeTaskWithReview(upgradeSeed.user.id, bridge.taskId, completionInput);
  assert.equal(replayed.reused, true);
  assert.equal(replayed.event.id, completed.event.id);
  assert.equal((await prisma.reviewEvent.count({ where: { reviewScheduleId: bridgeSchedule.id } })), 1);
  pass("bridge_complete_requires_review_event_result", {
    taskId: bridge.taskId,
    eventId: completed.event.id,
    result: completed.event.result,
    replayReused: replayed.reused,
  });
}

function pass(id: string, details: Record<string, string | number | boolean>): void {
  checks.push({ id, status: "pass", details });
}
