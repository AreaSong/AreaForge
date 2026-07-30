import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../packages/db/src/index";
import {
  addSimulationRemediationsToInbox,
  archiveSimulationLossItem,
  archiveSimulationLossItemCommand,
  confirmSimulationExam,
  createSimulationLossItem,
  createSimulationLossItemCommand,
  createSimulationExam,
  getSimulationExam,
  listSimulationExams,
  listSimulationRemediations,
  restoreSimulationLossItem,
  restoreSimulationLossItemCommand,
  saveSimulationExamResults,
  updateSimulationLossItem,
  updateSimulationLossItemCommand,
} from "../../apps/web/lib/study/simulation-service";
import { decidePeriodicReport, getPeriodicReportDecision } from "../../apps/web/lib/study/report-decisions-service";
import { getPeriodicReport } from "../../apps/web/lib/study/reports-service";
import {
  confirmStageAdjustmentDraft,
  createStageAdjustmentDraft,
  createStagePlan,
  getLatestStageAdjustmentDecisionResult,
  rejectStageAdjustmentDraft,
} from "../../apps/web/lib/study/stage-service";
import { ApiError } from "../../apps/web/lib/api/responses";
import {
  convertPlanInboxItem,
  listPlanInboxItems,
  updatePlanInboxItem,
} from "../../apps/web/lib/study/plan-inbox-service";
import { getPlanRolling } from "../../apps/web/lib/study/plan-rolling-service";
import { getAnalyticsSummary } from "../../apps/web/lib/study/analytics-service";
import { createAiStageAdjustmentDraft } from "../../apps/web/lib/study/long-term-stage-ai-service";
import { createStaticJsonProvider } from "../../packages/ai/src/index";
import {
  selectReportDecisionBaseline,
  selectStageDecisionBaseline,
} from "../../apps/web/lib/client/versioned-conflict-baseline";

const now = new Date("2026-07-22T04:00:00.000Z");

function stableRows<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

try {
  if (process.env.AREAFORGE_V11_M8_ISOLATED_DB !== "1") throw new Error("requires AREAFORGE_V11_M8_ISOLATED_DB=1");
  const [{ current_database: database }] = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!database.includes("v11m8")) throw new Error("refused database without v11m8 marker");

  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'SimulationSubjectResult' AND column_name IN ('paperFullScore', 'revision')
  `;
  assert.equal(columns.length, 2);
  assert.equal(await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE tablename = 'SimulationLossItem'`.then((rows) => rows.length), 1);

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "PlanInboxItem", "StageAdjustmentDraft", "StagePlan", "PeriodicReportDecision", "SimulationLossItem", "SimulationSubjectResult", "SimulationExam", "CheckIn", "DailyReview", "StudySession", "StudyTask", "SyllabusNode", "Subject", "SubjectGroup", "ExamWorkspace", "AuditEvent", "User" RESTART IDENTITY CASCADE`);
  const user = await prisma.user.create({ data: { email: `v11m8-${randomUUID()}@example.com`, passwordHash: "x" } });
  const workspace = await prisma.examWorkspace.create({ data: { userId: user.id, stableKey: "m8", name: "M8", status: "ACTIVE" } });
  const subject = await prisma.subject.create({ data: { workspaceId: workspace.id, stableKey: "math", name: "数学", color: "#14b8a6" } });
  const node = await prisma.syllabusNode.create({ data: { subjectId: subject.id, title: "极限", kind: "TOPIC" } });
  const foreignUser = await prisma.user.create({ data: { email: `v11m8-foreign-${randomUUID()}@example.com`, passwordHash: "x" } });
  const foreignWorkspace = await prisma.examWorkspace.create({ data: { userId: foreignUser.id, stableKey: "foreign", name: "Foreign", status: "ACTIVE" } });
  const foreignSubject = await prisma.subject.create({ data: { workspaceId: foreignWorkspace.id, stableKey: "english", name: "英语", color: "#f59e0b" } });

  const reportBaselineFixture = await getPeriodicReport("week", now, user.id);
  const nextReportFixture = {
    ...reportBaselineFixture,
    id: "week:2026-07-27",
    revision: 1,
    range: { ...reportBaselineFixture.range, start: "2026-07-27", end: "2026-08-03" },
  };
  assert.equal(selectReportDecisionBaseline(reportBaselineFixture, nextReportFixture).id, nextReportFixture.id);
  assert.equal(selectReportDecisionBaseline(nextReportFixture, reportBaselineFixture).id, nextReportFixture.id);

  const stageBaselineFixture = {
    id: "stage-old",
    revision: 2,
    stagePlanId: null,
    sourceReportDecisionId: null,
    sourceReportRevision: null,
    originVersion: 1,
    source: "local_rule" as const,
    mode: "maintain" as const,
    risk: "low" as const,
    riskConclusion: "old",
    focusSubjects: [],
    taskIntensity: "maintain" as const,
    taskAdjustmentActions: [],
    nextStageEmphasis: "old",
    canAutoApply: false as const,
    requiresUserConfirmation: true as const,
    status: "draft" as const,
    createdAt: "2026-07-22T01:00:00.000Z",
    appliedAt: null,
    actorId: user.id,
  };
  const supersedingStageFixture = {
    ...stageBaselineFixture,
    id: "stage-new",
    revision: 1,
    originVersion: 2,
    createdAt: "2026-07-22T02:00:00.000Z",
  };
  assert.equal(selectStageDecisionBaseline(stageBaselineFixture, supersedingStageFixture).id, supersedingStageFixture.id);
  assert.equal(selectStageDecisionBaseline(supersedingStageFixture, stageBaselineFixture).id, supersedingStageFixture.id);

  await prisma.studyTask.create({ data: { subjectId: foreignSubject.id, title: "foreign task", type: "focus", plannedDate: now, status: "DONE" } });
  const baselineTask = await prisma.studyTask.create({ data: { subjectId: subject.id, syllabusNodeId: node.id, title: "M8 baseline task", type: "focus", plannedDate: now } });
  const stagePlan = await prisma.stagePlan.create({
    data: {
      workspaceId: workspace.id,
      name: "基础阶段",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-08-31T00:00:00.000Z"),
      goal: "保持基础",
      mode: "maintain",
      status: "active",
    },
  });
  await assert.rejects(
    () => createStagePlan({
      idempotencyKey: `m8-stage-plan-conflict-${randomUUID()}`,
      baseRevision: null,
      name: "并发阶段",
      startDate: new Date("2026-07-01T00:00:00.000Z").toISOString(),
      endDate: new Date("2026-08-31T00:00:00.000Z").toISOString(),
      goal: "不得创建第二个当前阶段",
      mode: "maintain",
      status: "active",
    }, user.id),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "STAGE_PLAN_BASE_REVISION_CONFLICT");
      assert.equal(error.status, 409);
      assert.deepEqual(error.details?.conflictFields, ["baseRevision", "plan.revision"]);
      assert.equal(error.details?.workbench, "/stage/overview");
      const latest = error.details?.latest as { kind?: unknown; plan?: { id?: unknown; revision?: unknown } } | undefined;
      assert.equal(latest?.kind, "stage-plan");
      assert.equal(latest?.plan?.id, stagePlan.id);
      assert.equal(latest?.plan?.revision, stagePlan.revision);
      return true;
    },
  );
  const foreignStagePlan = await prisma.stagePlan.create({
    data: {
      workspaceId: foreignWorkspace.id,
      name: "Foreign stage",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-08-31T00:00:00.000Z"),
      goal: "foreign",
      mode: "maintain",
      status: "active",
    },
  });
  await assert.rejects(
    () => createAiStageAdjustmentDraft({
      idempotencyKey: `m8-ai-foreign-${randomUUID()}`,
      stagePlanId: foreignStagePlan.id,
    }, user.id),
    (error: unknown) => error instanceof ApiError && error.code === "STAGE_PLAN_NOT_FOUND",
  );
  const originalAiEnabled = process.env.AI_ENABLED;
  const originalSensitiveContext = process.env.AI_ALLOW_SENSITIVE_CONTEXT;
  const originalAuthSessionSecret = process.env.AUTH_SESSION_SECRET;
  process.env.AI_ENABLED = "true";
  process.env.AI_ALLOW_SENSITIVE_CONTEXT = "false";
  process.env.AUTH_SESSION_SECRET = "v11-m8-isolated-auth-session-secret-20260729";
  let aiStageDraft: Awaited<ReturnType<typeof createAiStageAdjustmentDraft>>;
  try {
    aiStageDraft = await createAiStageAdjustmentDraft({
      idempotencyKey: `m8-ai-stage-${randomUUID()}`,
      stagePlanId: stagePlan.id,
    }, user.id, {
      allowExternalProvider: true,
      provider: createStaticJsonProvider({
        mode: "strengthen",
        risk: "medium",
        riskConclusion: "当前工作区需要补强数学。",
        focusSubjects: ["数学"],
        taskIntensity: "increase",
        taskAdjustmentActions: ["retest"],
        nextStageEmphasis: "先补强当前工作区的数学证据。",
        canAutoApply: false,
        requiresUserConfirmation: true,
      }),
    });
  } finally {
    if (originalAiEnabled === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = originalAiEnabled;
    if (originalSensitiveContext === undefined) delete process.env.AI_ALLOW_SENSITIVE_CONTEXT;
    else process.env.AI_ALLOW_SENSITIVE_CONTEXT = originalSensitiveContext;
    if (originalAuthSessionSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = originalAuthSessionSecret;
  }
  const persistedAiStageDraft = await prisma.stageAdjustmentDraft.findUniqueOrThrow({ where: { id: aiStageDraft.draft.id } });
  assert.equal(persistedAiStageDraft.workspaceId, workspace.id);
  assert.equal(persistedAiStageDraft.stagePlanId, stagePlan.id);
  await prisma.stageAdjustmentDraft.delete({ where: { id: aiStageDraft.draft.id } });
  const exam = await createSimulationExam({ idempotencyKey: `m8-exam-${randomUUID()}`, name: "M8 模拟" }, user.id);
  const saved = await saveSimulationExamResults(exam.id, {
    expectedRevision: exam.revision,
    lossReasons: [],
    mindset: "稳定",
    summary: "完成",
    subjectResults: [{
      subjectId: subject.id,
      paperFullScore: 150,
      targetScore: 120,
      actualScore: 110,
      durationMinutes: 180,
      blankQuestionCount: 1,
      lossReasons: [],
      summary: "方法需要补强",
      lossItems: [{ reason: "METHOD_ERROR", syllabusNodeId: node.id, lostScore: 10, note: "步骤不稳" }],
    }],
  }, user.id);
  assert.equal(saved.totalsSource, "subject_sum");
  assert.equal(saved.actualScore, 110);
  assert.equal(saved.warnings.length, 1);
  const remediations = await listSimulationRemediations(exam.id, user.id);
  assert.equal(remediations.length, 1);
  const remediationSelection = [{ originKey: remediations[0]!.originKey, originVersion: remediations[0]!.originVersion }];
  assert.equal((await addSimulationRemediationsToInbox(exam.id, user.id, remediationSelection)).created, 1);
  assert.equal((await addSimulationRemediationsToInbox(exam.id, user.id, remediationSelection)).reused, 1);
  const firstInbox = (await listPlanInboxItems(user.id, "OPEN")).find((item) => item.originKey === remediations[0]!.originKey);
  assert.ok(firstInbox);
  const datedFirstInbox = await updatePlanInboxItem(user.id, firstInbox.id, {
    expectedRevision: firstInbox.revision,
    plannedDate: now.toISOString(),
  });
  assert.equal((await addSimulationRemediationsToInbox(exam.id, user.id, remediationSelection)).reused, 1);

  const secondExam = await createSimulationExam({ idempotencyKey: `m8-second-exam-${randomUUID()}`, name: "M8 同科同因第二场" }, user.id);
  const secondSaved = await saveSimulationExamResults(secondExam.id, {
    expectedRevision: secondExam.revision,
    lossReasons: [],
    mindset: "稳定",
    summary: "第二场完成",
    subjectResults: [{
      subjectId: subject.id,
      paperFullScore: 150,
      targetScore: 120,
      actualScore: 108,
      durationMinutes: 180,
      blankQuestionCount: 1,
      lossReasons: [],
      summary: "同一方法问题",
      lossItems: [{ reason: "METHOD_ERROR", syllabusNodeId: node.id, lostScore: 10, note: "第二场步骤不稳" }],
    }],
  }, user.id);
  const secondRemediations = await listSimulationRemediations(secondExam.id, user.id);
  assert.equal(secondRemediations.length, 1);
  assert.notEqual(secondRemediations[0]!.originKey, remediations[0]!.originKey);
  assert.equal((await addSimulationRemediationsToInbox(secondExam.id, user.id, [{
    originKey: secondRemediations[0]!.originKey,
    originVersion: secondRemediations[0]!.originVersion,
  }])).created, 1);
  const simulationInboxes = (await listPlanInboxItems(user.id, "OPEN"))
    .filter((item) => item.originType === "SIMULATION_LOSS");
  assert.equal(simulationInboxes.length, 2);
  const secondInbox = simulationInboxes.find((item) => item.originKey === secondRemediations[0]!.originKey);
  assert.ok(secondInbox);
  const datedSecondInbox = await updatePlanInboxItem(user.id, secondInbox.id, {
    expectedRevision: secondInbox.revision,
    plannedDate: now.toISOString(),
  });
  const secondLossItem = secondSaved.subjectResults[0]!.lossItems[0]!;
  const archivedSecondLoss = await archiveSimulationLossItem(
    secondSaved.subjectResults[0]!.id,
    secondLossItem.id,
    secondLossItem.revision,
    user.id,
  );
  const beforeArchivedConversion = await prisma.studyTask.count();
  await assert.rejects(
    () => convertPlanInboxItem(user.id, datedSecondInbox.id, {
      expectedRevision: datedSecondInbox.revision,
      idempotencyKey: `m8-archived-source-${randomUUID()}`,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "PLAN_INBOX_ORIGIN_STALE",
  );
  assert.equal(await prisma.studyTask.count(), beforeArchivedConversion);
  await restoreSimulationLossItem(
    secondSaved.subjectResults[0]!.id,
    secondLossItem.id,
    archivedSecondLoss.revision,
    user.id,
  );
  const restoredConversion = await convertPlanInboxItem(user.id, datedSecondInbox.id, {
    expectedRevision: datedSecondInbox.revision,
    idempotencyKey: `m8-restored-source-${randomUUID()}`,
  });
  assert.equal(restoredConversion.status, "CONVERTED");

  const revertedExam = await createSimulationExam({ idempotencyKey: `m8-reverted-exam-${randomUUID()}`, name: "M8 实质改动后改回" }, user.id);
  const revertedSaved = await saveSimulationExamResults(revertedExam.id, {
    expectedRevision: revertedExam.revision,
    lossReasons: [],
    summary: "版本回退校验",
    subjectResults: [{
      subjectId: subject.id,
      paperFullScore: 100,
      targetScore: 80,
      actualScore: 70,
      blankQuestionCount: 0,
      lossReasons: [],
      lossItems: [{ reason: "METHOD_ERROR", lostScore: 10 }],
    }],
  }, user.id);
  const [revertedRemediation] = await listSimulationRemediations(revertedExam.id, user.id);
  assert.ok(revertedRemediation);
  await addSimulationRemediationsToInbox(revertedExam.id, user.id, [{
    originKey: revertedRemediation.originKey,
    originVersion: revertedRemediation.originVersion,
  }]);
  const revertedInbox = (await listPlanInboxItems(user.id, "OPEN")).find((item) => (
    item.originKey === revertedRemediation.originKey
  ));
  assert.ok(revertedInbox);
  const datedRevertedInbox = await updatePlanInboxItem(user.id, revertedInbox.id, {
    expectedRevision: revertedInbox.revision,
    plannedDate: now.toISOString(),
  });
  const originalRevertedLoss = revertedSaved.subjectResults[0]!.lossItems[0]!;
  const changedRevertedLoss = await updateSimulationLossItem(revertedSaved.subjectResults[0]!.id, originalRevertedLoss.id, {
    expectedRevision: originalRevertedLoss.revision,
    reason: "CONCEPT_GAP",
    lostScore: 8,
  }, user.id);
  await updateSimulationLossItem(revertedSaved.subjectResults[0]!.id, originalRevertedLoss.id, {
    expectedRevision: changedRevertedLoss.revision,
    reason: "METHOD_ERROR",
    lostScore: 10,
  }, user.id);
  await assert.rejects(
    () => convertPlanInboxItem(user.id, datedRevertedInbox.id, {
      expectedRevision: datedRevertedInbox.revision,
      idempotencyKey: `m8-material-revert-${randomUUID()}`,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "PLAN_INBOX_ORIGIN_STALE",
  );

  const archivedSourceSubject = await prisma.subject.create({
    data: { workspaceId: workspace.id, stableKey: `archived-source-${randomUUID()}`, name: "归档来源科目", color: "#64748b" },
  });
  const activeRetargetSubject = await prisma.subject.create({
    data: { workspaceId: workspace.id, stableKey: `active-retarget-${randomUUID()}`, name: "改投目标科目", color: "#0f766e" },
  });
  const archivedSourceNode = await prisma.syllabusNode.create({
    data: { subjectId: archivedSourceSubject.id, title: "归档来源节点", kind: "TOPIC" },
  });
  const archivedSourceExam = await createSimulationExam({ idempotencyKey: `m8-archived-source-exam-${randomUUID()}`, name: "M8 归档来源" }, user.id);
  const archivedSourceSaved = await saveSimulationExamResults(archivedSourceExam.id, {
    expectedRevision: archivedSourceExam.revision,
    lossReasons: [],
    summary: "归档来源校验",
    subjectResults: [{
      subjectId: archivedSourceSubject.id,
      paperFullScore: 100,
      targetScore: 80,
      actualScore: 70,
      blankQuestionCount: 0,
      lossReasons: [],
      lossItems: [{ reason: "CONCEPT_GAP", syllabusNodeId: archivedSourceNode.id, lostScore: 10 }],
    }],
  }, user.id);
  const [archivedSourceRemediation] = await listSimulationRemediations(archivedSourceExam.id, user.id);
  assert.ok(archivedSourceRemediation);
  await addSimulationRemediationsToInbox(archivedSourceExam.id, user.id, [{
    originKey: archivedSourceRemediation.originKey,
    originVersion: archivedSourceRemediation.originVersion,
  }]);
  const archivedSourceInbox = (await listPlanInboxItems(user.id, "OPEN")).find((item) => (
    item.originKey === archivedSourceRemediation.originKey
  ));
  assert.ok(archivedSourceInbox);
  const retargetedSourceInbox = await updatePlanInboxItem(user.id, archivedSourceInbox.id, {
    expectedRevision: archivedSourceInbox.revision,
    subjectId: activeRetargetSubject.id,
    primaryNodeId: null,
    relatedNodeIds: [],
    plannedDate: now.toISOString(),
  });
  await prisma.subject.update({
    where: { id: archivedSourceSubject.id },
    data: { archivedAt: new Date() },
  });
  await assert.rejects(
    () => convertPlanInboxItem(user.id, retargetedSourceInbox.id, {
      expectedRevision: retargetedSourceInbox.revision,
      idempotencyKey: `m8-archived-subject-${randomUUID()}`,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "PLAN_INBOX_ORIGIN_ARCHIVED",
  );

  const newerExam = await createSimulationExam({ idempotencyKey: `m8-newer-exam-${randomUUID()}`, name: "M8 恢复后新版" }, user.id);
  const newerSaved = await saveSimulationExamResults(newerExam.id, {
    expectedRevision: newerExam.revision,
    lossReasons: [],
    summary: "恢复后新版校验",
    subjectResults: [{
      subjectId: activeRetargetSubject.id,
      paperFullScore: 100,
      targetScore: 80,
      actualScore: 72,
      blankQuestionCount: 0,
      lossReasons: [],
      lossItems: [{ reason: "METHOD_ERROR", lostScore: 8 }],
    }],
  }, user.id);
  const [oldRemediation] = await listSimulationRemediations(newerExam.id, user.id);
  assert.ok(oldRemediation);
  await addSimulationRemediationsToInbox(newerExam.id, user.id, [{
    originKey: oldRemediation.originKey,
    originVersion: oldRemediation.originVersion,
  }]);
  const oldInbox = (await listPlanInboxItems(user.id, "OPEN")).find((item) => (
    item.originKey === oldRemediation.originKey && item.originVersion === oldRemediation.originVersion
  ));
  assert.ok(oldInbox);
  const datedOldInbox = await updatePlanInboxItem(user.id, oldInbox.id, {
    expectedRevision: oldInbox.revision,
    plannedDate: now.toISOString(),
  });
  const newerLoss = newerSaved.subjectResults[0]!.lossItems[0]!;
  const archivedNewerLoss = await archiveSimulationLossItem(
    newerSaved.subjectResults[0]!.id,
    newerLoss.id,
    newerLoss.revision,
    user.id,
  );
  await restoreSimulationLossItem(
    newerSaved.subjectResults[0]!.id,
    newerLoss.id,
    archivedNewerLoss.revision,
    user.id,
  );
  const [newRemediation] = await listSimulationRemediations(newerExam.id, user.id);
  assert.ok(newRemediation);
  assert.ok(newRemediation.originVersion > oldRemediation.originVersion);
  await addSimulationRemediationsToInbox(newerExam.id, user.id, [{
    originKey: newRemediation.originKey,
    originVersion: newRemediation.originVersion,
  }]);
  const supersededOldInbox = await prisma.planInboxItem.findUniqueOrThrow({
    where: { id: datedOldInbox.id },
    select: { revision: true },
  });
  await assert.rejects(
    () => convertPlanInboxItem(user.id, datedOldInbox.id, {
      expectedRevision: supersededOldInbox.revision,
      idempotencyKey: `m8-restored-newer-${randomUUID()}`,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "PLAN_INBOX_SUPERSEDED",
  );

  const concurrentSaves = await Promise.allSettled([
    saveSimulationExamResults(exam.id, {
      expectedRevision: saved.revision,
      lossReasons: [],
      mindset: "稳定",
      summary: "并发 A",
      subjectResults: [{
        subjectId: subject.id,
        expectedRevision: saved.subjectResults[0]!.revision,
        paperFullScore: 150,
        targetScore: 120,
        actualScore: 111,
        durationMinutes: 180,
        blankQuestionCount: 1,
        lossReasons: [],
        summary: "A",
        lossItems: [{ reason: "METHOD_ERROR", syllabusNodeId: node.id, lostScore: 9, note: "A" }],
      }],
    }, user.id),
    saveSimulationExamResults(exam.id, {
      expectedRevision: saved.revision,
      lossReasons: [],
      mindset: "稳定",
      summary: "并发 B",
      subjectResults: [{
        subjectId: subject.id,
        expectedRevision: saved.subjectResults[0]!.revision,
        paperFullScore: 150,
        targetScore: 120,
        actualScore: 112,
        durationMinutes: 180,
        blankQuestionCount: 1,
        lossReasons: [],
        summary: "B",
        lossItems: [{ reason: "METHOD_ERROR", syllabusNodeId: node.id, lostScore: 8, note: "B" }],
      }],
    }, user.id),
  ]);
  assert.equal(concurrentSaves.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrentSaves.filter((result) => result.status === "rejected").length, 1);
  const rejectedSave = concurrentSaves.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.ok(rejectedSave?.reason instanceof ApiError);
  assert.equal(rejectedSave.reason.code, "SIMULATION_EXAM_REVISION_CONFLICT");
  const conflictExam = rejectedSave.reason.details?.latest as { id?: unknown; revision?: unknown; subjectResults?: unknown } | undefined;
  assert.equal(conflictExam?.id, exam.id);
  assert.equal(typeof conflictExam?.revision, "number");
  assert.ok(Array.isArray(conflictExam?.subjectResults));
  assert.deepEqual(rejectedSave.reason.details?.conflictFields, ["revision"]);
  await assert.rejects(
    () => addSimulationRemediationsToInbox(exam.id, user.id, remediationSelection),
    (error: unknown) => error instanceof Error && error.message === "SIMULATION_REMEDIATION_STALE",
  );
  const beforeStaleConversion = await prisma.studyTask.count();
  await assert.rejects(
    () => convertPlanInboxItem(user.id, datedFirstInbox.id, {
      expectedRevision: datedFirstInbox.revision,
      idempotencyKey: `m8-stale-source-${randomUUID()}`,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "PLAN_INBOX_ORIGIN_STALE",
  );
  assert.equal(await prisma.studyTask.count(), beforeStaleConversion);

  const currentRemediations = await listSimulationRemediations(exam.id, user.id);
  assert.equal(currentRemediations.length, 1);
  assert.equal((await addSimulationRemediationsToInbox(exam.id, user.id, [{
    originKey: currentRemediations[0]!.originKey,
    originVersion: currentRemediations[0]!.originVersion,
  }])).created, 1);
  const currentInbox = (await listPlanInboxItems(user.id, "OPEN")).find((item) => (
    item.originKey === currentRemediations[0]!.originKey
    && item.originVersion === currentRemediations[0]!.originVersion
  ));
  assert.ok(currentInbox);
  const datedInbox = await updatePlanInboxItem(user.id, currentInbox.id, {
    expectedRevision: currentInbox.revision,
    plannedDate: now.toISOString(),
  });
  const conversionKey = `m8-inbox-convert-${randomUUID()}`;
  const convertedResults = await Promise.all([
    convertPlanInboxItem(user.id, datedInbox.id, {
      expectedRevision: datedInbox.revision,
      idempotencyKey: conversionKey,
    }),
    convertPlanInboxItem(user.id, datedInbox.id, {
      expectedRevision: datedInbox.revision,
      idempotencyKey: conversionKey,
    }),
  ]);
  const convertedInbox = convertedResults[0]!;
  assert.ok(convertedInbox.convertedTaskId);
  assert.equal(convertedResults[1]!.convertedTaskId, convertedInbox.convertedTaskId);
  assert.equal(await prisma.studyTask.count({ where: { id: convertedInbox.convertedTaskId } }), 1);
  const rolling = await getPlanRolling(user.id, { date: "2026-07-22" });
  assert.equal(rolling.workspaceId, workspace.id);
  assert.equal(rolling.days.length, 7);
  assert.equal(rolling.tasks.filter((task) => task.id === convertedInbox.convertedTaskId).length, 1);

  const legacy = await prisma.simulationExam.create({ data: { name: "Legacy", examDate: now, targetScore: 100, actualScore: 60 } });
  const legacyBefore = await prisma.simulationExam.findUniqueOrThrow({ where: { id: legacy.id } });
  await assert.rejects(
    () => getSimulationExam(legacy.id, user.id),
    (error: unknown) => error instanceof Error && error.message === "SIMULATION_EXAM_NOT_FOUND",
  );
  assert.equal((await listSimulationExams(user.id)).some((item) => item.id === legacy.id), false);
  await assert.rejects(
    () => listSimulationRemediations(legacy.id, user.id),
    (error: unknown) => error instanceof Error && error.message === "SIMULATION_EXAM_NOT_FOUND",
  );
  await assert.rejects(
    () => saveSimulationExamResults(legacy.id, {
      expectedRevision: legacy.revision,
      lossReasons: [],
      summary: "不得写 legacy",
      subjectResults: [{
        subjectId: subject.id,
        paperFullScore: 100,
        targetScore: 80,
        actualScore: 60,
        blankQuestionCount: 0,
        lossReasons: [],
        lossItems: [],
      }],
    }, user.id),
    (error: unknown) => error instanceof Error && error.message === "SIMULATION_EXAM_NOT_FOUND",
  );
  assert.deepEqual(await prisma.simulationExam.findUniqueOrThrow({ where: { id: legacy.id } }), legacyBefore);

  const ownedLegacy = await prisma.simulationExam.create({
    data: { workspaceId: workspace.id, name: "Owned legacy", examDate: now, targetScore: 100, actualScore: 60 },
  });
  assert.equal((await getSimulationExam(ownedLegacy.id, user.id)).totalsSource, "legacy_fallback");
  const upgradedLegacy = await saveSimulationExamResults(ownedLegacy.id, {
    expectedRevision: ownedLegacy.revision,
    lossReasons: [],
    summary: "补齐旧记录分科结果",
    subjectResults: [{
      subjectId: subject.id,
      paperFullScore: 100,
      targetScore: 80,
      actualScore: 60,
      blankQuestionCount: 0,
      lossReasons: [],
      lossItems: [],
    }],
  }, user.id);
  assert.equal(upgradedLegacy.totalsSource, "subject_sum");
  assert.equal(upgradedLegacy.subjectResults.length, 1);
  assert.equal(await prisma.auditEvent.count({
    where: { entityId: ownedLegacy.id, action: "SIMULATION_LEGACY_RESULTS_UPGRADED" },
  }), 1);

  const report = await getPeriodicReport("week", now, user.id);
  const analytics = await getAnalyticsSummary(now, user.id);
  assert.deepEqual(report.range, analytics.range);
  assert.equal(report.metrics.effectiveMinutes, analytics.totals.weekEffectiveMinutes);
  assert.equal(report.metrics.taskCompletionRate, analytics.totals.weeklyTaskCompletionRate);
  assert.notEqual(report.weakness.source, "simulation_loss");
  const stagePlanBeforeReport = await prisma.stagePlan.findUniqueOrThrow({ where: { id: stagePlan.id } });
  const tasksBeforeReport = stableRows(await prisma.studyTask.findMany({ where: { subject: { workspaceId: workspace.id } } }));
  await assert.rejects(
    () => decidePeriodicReport({
      kind: "week",
      action: "confirm",
      expectedRevision: report.revision + 1,
      rangeStart: report.range.start,
      rangeEnd: report.range.end,
    }, user.id, now),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "PERIODIC_REPORT_REVISION_CONFLICT");
      assert.deepEqual(error.details?.conflictFields, ["revision"]);
      assert.equal(error.details?.workbench, "/review/reports");
      const latest = error.details?.latest as { kind?: unknown; report?: { id?: unknown; revision?: unknown }; decision?: unknown } | undefined;
      assert.equal(latest?.kind, "periodic-report-decision");
      assert.equal(latest?.report?.id, report.id);
      assert.equal(latest?.report?.revision, report.revision);
      assert.equal(latest?.decision, null);
      return true;
    },
  );
  const reportDecision = await decidePeriodicReport({
    kind: "week",
    action: "confirm",
    expectedRevision: report.revision,
    rangeStart: report.range.start,
    rangeEnd: report.range.end,
  }, user.id, now);
  assert.equal(reportDecision.status, "confirmed");
  assert.deepEqual(await prisma.stagePlan.findUniqueOrThrow({ where: { id: stagePlan.id } }), stagePlanBeforeReport);
  assert.deepEqual(stableRows(await prisma.studyTask.findMany({ where: { subject: { workspaceId: workspace.id } } })), tasksBeforeReport);
  const reportInboxCount = await prisma.planInboxItem.count({ where: { workspaceId: workspace.id, originType: "PERIODIC_REPORT" } });
  const reportDraftCount = await prisma.stageAdjustmentDraft.count({ where: { workspaceId: workspace.id, status: "draft" } });
  assert.ok(reportInboxCount > 0);
  assert.equal(reportDraftCount, 1);
  assert.ok(reportDecision.stageDraftId);
  assert.equal(reportDecision.inboxResult.createdCount, reportInboxCount);
  const reportRetry = await decidePeriodicReport({
    kind: "week",
    action: "confirm",
    expectedRevision: report.revision,
    rangeStart: report.range.start,
    rangeEnd: report.range.end,
  }, user.id, now);
  assert.equal(reportRetry.alreadyDecided, true);
  assert.equal(await prisma.planInboxItem.count({ where: { workspaceId: workspace.id, originType: "PERIODIC_REPORT" } }), reportInboxCount);
  assert.equal(await prisma.stageAdjustmentDraft.count({ where: { workspaceId: workspace.id } }), reportDraftCount);

  const reportStageDraft = await prisma.stageAdjustmentDraft.findUniqueOrThrow({ where: { id: reportDecision.stageDraftId! } });
  const reportStageApplied = await confirmStageAdjustmentDraft(reportStageDraft.id, reportStageDraft.revision, user.id);
  assert.equal(reportStageApplied.stageDraftId, reportStageDraft.id);
  assert.equal(reportStageApplied.inboxResult.createdCount, reportInboxCount);
  assert.equal(reportStageApplied.inboxResult.supersededCount, reportInboxCount);
  assert.equal(await prisma.planInboxItem.count({
    where: { workspaceId: workspace.id, originType: "PERIODIC_REPORT", supersededByItemId: { not: null } },
  }), reportInboxCount);
  const currentReportStageInboxCount = await prisma.planInboxItem.count({
    where: { workspaceId: workspace.id, originType: "STAGE_ADJUSTMENT", supersededByItemId: null },
  });
  assert.equal(currentReportStageInboxCount, reportInboxCount);
  const refreshedReport = await getPeriodicReport("week", now, user.id);
  assert.equal(refreshedReport.decision?.stageDraftId, reportStageDraft.id);
  assert.equal(refreshedReport.decision?.inboxResult.createdCount, currentReportStageInboxCount);
  assert.equal(refreshedReport.decision?.inboxResult.supersededCount, reportInboxCount);
  const reportDetail = await getPeriodicReportDecision(reportDecision.id, user.id);
  assert.equal(reportDetail.stageDraftId, reportStageDraft.id);
  assert.equal(reportDetail.inboxResult.createdCount, currentReportStageInboxCount);

  const monthlyReport = await getPeriodicReport("month", now, user.id);
  const reportInboxBeforeReject = await prisma.planInboxItem.count({ where: { workspaceId: workspace.id } });
  const reportDraftsBeforeReject = await prisma.stageAdjustmentDraft.count({ where: { workspaceId: workspace.id } });
  const rejectedReport = await decidePeriodicReport({
    kind: "month",
    action: "reject",
    expectedRevision: monthlyReport.revision,
    rangeStart: monthlyReport.range.start,
    rangeEnd: monthlyReport.range.end,
  }, user.id, now);
  assert.equal(rejectedReport.status, "rejected");
  const rejectedReportRetry = await decidePeriodicReport({
    kind: "month",
    action: "reject",
    expectedRevision: monthlyReport.revision,
    rangeStart: monthlyReport.range.start,
    rangeEnd: monthlyReport.range.end,
  }, user.id, now);
  assert.equal(rejectedReportRetry.alreadyDecided, true);
  await assert.rejects(
    () => decidePeriodicReport({
      kind: "month",
      action: "confirm",
      expectedRevision: monthlyReport.revision,
      rangeStart: monthlyReport.range.start,
      rangeEnd: monthlyReport.range.end,
    }, user.id, now),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "PERIODIC_REPORT_DECISION_CONFLICT");
      assert.equal(error.status, 409);
      assert.deepEqual(error.details?.conflictFields, ["decision.status"]);
      assert.equal(error.details?.workbench, "/review/reports");
      const latest = error.details?.latest as { kind?: unknown; report?: { id?: unknown }; decision?: { status?: unknown } } | undefined;
      assert.equal(latest?.kind, "periodic-report-decision");
      assert.equal(latest?.report?.id, monthlyReport.id);
      assert.equal(latest?.decision?.status, "rejected");
      return true;
    },
  );
  assert.equal(await prisma.planInboxItem.count({ where: { workspaceId: workspace.id } }), reportInboxBeforeReject);
  assert.equal(await prisma.stageAdjustmentDraft.count({ where: { workspaceId: workspace.id } }), reportDraftsBeforeReject);

  const rejectedStageVersion = await createStageAdjustmentDraft({
    idempotencyKey: `m8-rejected-stage-${randomUUID()}`,
    stagePlanId: stagePlan.id,
  }, user.id, now);
  const rejectedStageResult = await rejectStageAdjustmentDraft(rejectedStageVersion.id, rejectedStageVersion.revision, user.id);
  const rejectedStage = rejectedStageResult.draft;
  assert.equal(rejectedStage.status, "rejected");
  assert.equal(rejectedStageResult.stageDraftId, rejectedStage.id);
  assert.equal(rejectedStageResult.inboxResult.createdCount, 0);
  const rejectedStageRetry = await rejectStageAdjustmentDraft(rejectedStageVersion.id, rejectedStageVersion.revision, user.id);
  assert.equal(rejectedStageRetry.draft.id, rejectedStage.id);
  await assert.rejects(
    () => confirmStageAdjustmentDraft(rejectedStageVersion.id, rejectedStageVersion.revision, user.id),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "STAGE_ADJUSTMENT_DRAFT_REJECTED");
      assert.deepEqual(error.details?.conflictFields, ["draft.status"]);
      assert.equal(error.details?.workbench, "/stage/overview");
      const latest = error.details?.latest as { kind?: unknown; draft?: { id?: unknown; status?: unknown }; stagePlan?: { id?: unknown } } | undefined;
      assert.equal(latest?.kind, "stage-adjustment-decision");
      assert.equal(latest?.draft?.id, rejectedStage.id);
      assert.equal(latest?.draft?.status, "rejected");
      assert.equal(latest?.stagePlan?.id, stagePlan.id);
      return true;
    },
  );
  const rebuiltStageVersion = await createStageAdjustmentDraft({
    idempotencyKey: `m8-rebuilt-stage-${randomUUID()}`,
    stagePlanId: stagePlan.id,
  }, user.id, now);
  assert.notEqual(rebuiltStageVersion.id, rejectedStage.id);
  assert.equal(rebuiltStageVersion.status, "draft");
  assert.equal((await prisma.stageAdjustmentDraft.findUniqueOrThrow({ where: { id: rejectedStage.id } })).status, "rejected");

  const stageDraft = await prisma.stageAdjustmentDraft.create({
    data: {
      workspaceId: workspace.id,
      stagePlanId: stagePlan.id,
      source: "local_rule",
      mode: "strengthen",
      risk: "high",
      riskConclusion: "补强极限",
      focusSubjects: ["数学"],
      taskIntensity: "keep",
      taskAdjustmentActions: ["simulate", "retest"],
      nextStageEmphasis: "补强极限并复测",
      status: "draft",
      actorId: user.id,
    },
  });
  await assert.rejects(
    () => confirmStageAdjustmentDraft(rebuiltStageVersion.id, rebuiltStageVersion.revision, user.id),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "STAGE_ADJUSTMENT_DRAFT_SUPERSEDED");
      assert.equal(error.status, 409);
      assert.deepEqual(error.details?.conflictFields, ["draft.id", "draft.originVersion"]);
      assert.equal(error.details?.workbench, "/stage/overview");
      const latest = error.details?.latest as { kind?: unknown; draft?: { id?: unknown }; stagePlan?: { id?: unknown } } | undefined;
      assert.equal(latest?.kind, "stage-adjustment-decision");
      assert.equal(latest?.draft?.id, stageDraft.id);
      assert.equal(latest?.stagePlan?.id, stagePlan.id);
      return true;
    },
  );
  const tasksBeforeStage = stableRows(await prisma.studyTask.findMany({ where: { subject: { workspaceId: workspace.id } } }));
  const stagePlanBeforeManual = await prisma.stagePlan.findUniqueOrThrow({ where: { id: stagePlan.id } });
  const stageInboxBeforeManual = await prisma.planInboxItem.count({ where: { workspaceId: workspace.id, originType: "STAGE_ADJUSTMENT" } });
  const applied = await confirmStageAdjustmentDraft(stageDraft.id, stageDraft.revision, user.id);
  assert.equal(applied.draft.status, "applied");
  assert.equal(applied.stageDraftId, stageDraft.id);
  assert.equal(applied.inboxResult.createdCount, 2);
  const stagePlanAfter = await prisma.stagePlan.findUniqueOrThrow({ where: { id: stagePlan.id } });
  assert.equal(stagePlanAfter.goal, "补强极限并复测");
  assert.equal(stagePlanAfter.revision, stagePlanBeforeManual.revision + 1);
  assert.deepEqual(stableRows(await prisma.studyTask.findMany({ where: { subject: { workspaceId: workspace.id } } })), tasksBeforeStage);
  assert.equal(await prisma.planInboxItem.count({ where: { workspaceId: workspace.id, originType: "STAGE_ADJUSTMENT" } }), stageInboxBeforeManual + 2);
  const appliedReplay = await confirmStageAdjustmentDraft(stageDraft.id, stageDraft.revision, user.id);
  assert.deepEqual(appliedReplay.inboxResult, applied.inboxResult);
  assert.equal(await prisma.planInboxItem.count({ where: { workspaceId: workspace.id, originType: "STAGE_ADJUSTMENT" } }), stageInboxBeforeManual + 2);

  const latestStageDecision = await getLatestStageAdjustmentDecisionResult(user.id);
  assert.equal(latestStageDecision?.draft.id, stageDraft.id);
  assert.equal(latestStageDecision?.status, "applied");
  assert.deepEqual(latestStageDecision?.inboxResult, applied.inboxResult);
  const appliedAudit = await prisma.auditEvent.findFirstOrThrow({
    where: {
      actorId: user.id,
      action: "STAGE_ADJUSTMENT_DRAFT_APPLIED",
      entityType: "StageAdjustmentDraft",
      entityId: stageDraft.id,
    },
    orderBy: { createdAt: "desc" },
  });
  await prisma.auditEvent.update({
    where: { id: appliedAudit.id },
    data: { metadata: { decisionStatus: "applied" } },
  });
  assert.equal((await getLatestStageAdjustmentDecisionResult(user.id))?.inboxResult, null);

  const compatibilityExam = await createSimulationExam({
    idempotencyKey: `m8-loss-compat-${randomUUID()}`,
    name: "M8 失分兼容合同",
  }, user.id);
  const compatibilitySaved = await saveSimulationExamResults(compatibilityExam.id, {
    expectedRevision: compatibilityExam.revision,
    lossReasons: [],
    mindset: "稳定",
    summary: "兼容基线",
    subjectResults: [{
      subjectId: subject.id,
      paperFullScore: 150,
      targetScore: 120,
      actualScore: 140,
      durationMinutes: 180,
      blankQuestionCount: 0,
      lossReasons: [],
      summary: "兼容基线",
      lossItems: [{ reason: "METHOD_ERROR", syllabusNodeId: node.id, lostScore: 10, note: "稳定条目" }],
    }],
  }, user.id);
  const compatibilitySubject = compatibilitySaved.subjectResults[0]!;
  const stableCompatibilityLoss = compatibilitySubject.lossItems.find((item) => !item.archivedAt)!;
  const omittedLossItems = await saveSimulationExamResults(compatibilityExam.id, {
    expectedRevision: compatibilitySaved.revision,
    lossReasons: [],
    mindset: "稳定",
    summary: "省略失分数组",
    subjectResults: [{
      subjectId: subject.id,
      expectedRevision: compatibilitySubject.revision,
      paperFullScore: 150,
      targetScore: 120,
      actualScore: 140,
      durationMinutes: 180,
      blankQuestionCount: 0,
      lossReasons: [],
      summary: "省略失分数组",
    }],
  }, user.id);
  const lossAfterOmission = omittedLossItems.subjectResults[0]!.lossItems.find((item) => item.id === stableCompatibilityLoss.id)!;
  assert.equal(lossAfterOmission.revision, stableCompatibilityLoss.revision);
  assert.equal(lossAfterOmission.archivedAt, null);

  const explicitlyReplaced = await saveSimulationExamResults(compatibilityExam.id, {
    expectedRevision: omittedLossItems.revision,
    lossReasons: [],
    mindset: "稳定",
    summary: "显式兼容替换",
    subjectResults: [{
      subjectId: subject.id,
      expectedRevision: omittedLossItems.subjectResults[0]!.revision,
      paperFullScore: 150,
      targetScore: 120,
      actualScore: 140,
      durationMinutes: 180,
      blankQuestionCount: 0,
      lossReasons: [],
      summary: "显式兼容替换",
      lossItems: [{ reason: "METHOD_ERROR", syllabusNodeId: node.id, lostScore: 10, note: "替换条目" }],
    }],
  }, user.id);
  assert.ok(explicitlyReplaced.subjectResults[0]!.lossItems.find((item) => item.id === stableCompatibilityLoss.id)?.archivedAt);
  assert.notEqual(explicitlyReplaced.subjectResults[0]!.lossItems.find((item) => !item.archivedAt)?.id, stableCompatibilityLoss.id);

  const examBeforeLossLifecycle = await getSimulationExam(exam.id, user.id);
  const subjectResultId = examBeforeLossLifecycle.subjectResults[0]!.id;
  const subjectBeforeLossLifecycle = examBeforeLossLifecycle.subjectResults[0]!;
  const lossIdempotencyKey = `m8-loss-${randomUUID()}`;
  const createdLossCommand = await createSimulationLossItemCommand(subjectResultId, {
    idempotencyKey: lossIdempotencyKey,
    expectedExamRevision: examBeforeLossLifecycle.revision,
    expectedSubjectResultRevision: subjectBeforeLossLifecycle.revision,
    reason: "METHOD_ERROR",
    syllabusNodeId: node.id,
    lostScore: 1,
    note: "单项生命周期",
  }, user.id);
  const createdLoss = createdLossCommand.lossItem;
  assert.equal(createdLossCommand.versions.examRevision, examBeforeLossLifecycle.revision + 1);
  assert.equal(createdLossCommand.versions.subjectResultRevision, subjectBeforeLossLifecycle.revision + 1);
  const replayedLossCommand = await createSimulationLossItemCommand(subjectResultId, {
    idempotencyKey: lossIdempotencyKey,
    expectedExamRevision: examBeforeLossLifecycle.revision,
    expectedSubjectResultRevision: subjectBeforeLossLifecycle.revision,
    reason: "METHOD_ERROR",
    syllabusNodeId: node.id,
    lostScore: 1,
    note: "单项生命周期",
  }, user.id);
  assert.equal(replayedLossCommand.lossItem.id, createdLoss.id);
  assert.deepEqual(replayedLossCommand.versions, createdLossCommand.versions);

  const parentAdvanced = await saveSimulationExamResults(exam.id, {
    expectedRevision: createdLossCommand.versions.examRevision,
    lossReasons: [],
    mindset: examBeforeLossLifecycle.mindset ?? undefined,
    summary: "父版本推进",
    subjectResults: [{
      subjectId: subject.id,
      expectedRevision: createdLossCommand.versions.subjectResultRevision,
      paperFullScore: subjectBeforeLossLifecycle.paperFullScore!,
      targetScore: subjectBeforeLossLifecycle.targetScore!,
      actualScore: subjectBeforeLossLifecycle.actualScore!,
      durationMinutes: subjectBeforeLossLifecycle.durationMinutes ?? undefined,
      blankQuestionCount: subjectBeforeLossLifecycle.blankQuestionCount,
      lossReasons: subjectBeforeLossLifecycle.lossReasons,
      summary: subjectBeforeLossLifecycle.summary ?? undefined,
    }],
  }, user.id);
  await assert.rejects(
    () => updateSimulationLossItemCommand(subjectResultId, createdLoss.id, {
      expectedRevision: createdLoss.revision,
      expectedExamRevision: createdLossCommand.versions.examRevision,
      expectedSubjectResultRevision: createdLossCommand.versions.subjectResultRevision,
      lostScore: 2,
    }, user.id),
    (error: unknown) => error instanceof ApiError && error.code === "SIMULATION_EXAM_REVISION_CONFLICT",
  );
  assert.equal((await prisma.simulationLossItem.findUniqueOrThrow({ where: { id: createdLoss.id } })).lostScore, 1);

  const parentAdvancedSubject = parentAdvanced.subjectResults[0]!;
  const updatedLossCommand = await updateSimulationLossItemCommand(subjectResultId, createdLoss.id, {
    expectedRevision: createdLoss.revision,
    expectedExamRevision: parentAdvanced.revision,
    expectedSubjectResultRevision: parentAdvancedSubject.revision,
    lostScore: 1.5,
  }, user.id);
  const updatedLoss = updatedLossCommand.lossItem;
  await assert.rejects(
    () => updateSimulationLossItem(subjectResultId, createdLoss.id, { expectedRevision: createdLoss.revision, lostScore: 2 }, user.id),
    (error: unknown) => error instanceof Error && error.message === "SIMULATION_LOSS_ITEM_REVISION_CONFLICT",
  );
  const archivedLossCommand = await archiveSimulationLossItemCommand(subjectResultId, createdLoss.id, {
    expectedRevision: updatedLoss.revision,
    expectedExamRevision: updatedLossCommand.versions.examRevision,
    expectedSubjectResultRevision: updatedLossCommand.versions.subjectResultRevision,
  }, user.id);
  const archivedLoss = archivedLossCommand.lossItem;
  assert.ok(archivedLoss.archivedAt);
  const restoredLossCommand = await restoreSimulationLossItemCommand(subjectResultId, createdLoss.id, {
    expectedRevision: archivedLoss.revision,
    expectedExamRevision: archivedLossCommand.versions.examRevision,
    expectedSubjectResultRevision: archivedLossCommand.versions.subjectResultRevision,
  }, user.id);
  const restoredLoss = restoredLossCommand.lossItem;
  assert.equal(restoredLoss.archivedAt, null);
  const latestExam = await getSimulationExam(exam.id, user.id);
  const confirmedExam = await confirmSimulationExam(exam.id, latestExam.revision, user.id);
  assert.equal(confirmedExam.status, "CONFIRMED");
  await assert.rejects(
    () => createSimulationLossItem(subjectResultId, {
      idempotencyKey: `m8-confirmed-loss-${randomUUID()}`,
      reason: "OTHER",
      lostScore: 0.5,
    }, user.id),
    (error: unknown) => error instanceof Error && error.message === "SIMULATION_EXAM_CONFIRMED",
  );

  await assert.rejects(() => prisma.simulationLossItem.create({ data: { simulationSubjectResultId: saved.subjectResults[0]!.id, reason: "METHOD_ERROR", lostScore: 0.3 } }));
  assert.equal(baselineTask.id, tasksBeforeReport.find((task) => task.id === baselineTask.id)?.id);
  console.log(JSON.stringify({
    schemaVersion: "v11-m8-runtime-selftest-v4",
    status: "pass",
    database,
    checks: {
      migration8Schema: "pass",
      simulationCasAndRemediationTransaction: "pass",
      simulationExamScopedOrigins: "pass",
      staleAndArchivedRemediationConversionRejected: "pass",
      materialSimulationEditRevertRejected: "pass",
      simulationInboxConcurrentConversionIdempotent: "pass",
      reportConfirmNoStagePlanOrTaskMutation: "pass",
      reportStageLineageRefreshAndSupersede: "pass",
      reportRejectTerminalAndIdempotent: "pass",
      stageConfirmNoTaskMutation: "pass",
      supersededStageDraftConfirmRejected: "pass",
      stageRejectAndNewVersionRebuild: "pass",
      stageDecisionRefreshReplayAndLegacyFallback: "pass",
      legacyTotalsHiddenFromCurrentWorkspace: "pass",
      lossItemLifecycleAndExamConfirmation: "pass",
      lossItemStableBulkCompatibilityAndParentCas: "pass",
      crossPageCanonicalFixture: "pass",
      workspaceIsolationAndSevenDayDto: "pass",
      crossIdClientConflictBaseline: "pass",
    },
  }, null, 2));
  console.log("PASS v11 M8 isolated PostgreSQL runtime selftest");
} finally {
  await prisma.$disconnect();
}
