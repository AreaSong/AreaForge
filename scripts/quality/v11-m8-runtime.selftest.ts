import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../packages/db/src/index";
import {
  addSimulationRemediationsToInbox,
  createSimulationExam,
  getSimulationExam,
  listSimulationExams,
  listSimulationRemediations,
  saveSimulationExamResults,
} from "../../apps/web/lib/study/simulation-service";
import { decidePeriodicReport } from "../../apps/web/lib/study/report-decisions-service";
import { getPeriodicReport } from "../../apps/web/lib/study/reports-service";
import { confirmStageAdjustmentDraft } from "../../apps/web/lib/study/stage-service";
import {
  convertPlanInboxItem,
  listPlanInboxItems,
  updatePlanInboxItem,
} from "../../apps/web/lib/study/plan-inbox-service";
import { getPlanRolling } from "../../apps/web/lib/study/plan-rolling-service";
import { getAnalyticsSummary } from "../../apps/web/lib/study/analytics-service";

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
  const exam = await createSimulationExam({ name: "M8 模拟" }, user.id);
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
  await assert.rejects(
    () => addSimulationRemediationsToInbox(exam.id, user.id, remediationSelection),
    (error: unknown) => error instanceof Error && error.message === "SIMULATION_REMEDIATION_STALE",
  );

  const simulationInbox = (await listPlanInboxItems(user.id, "OPEN")).find((item) => item.originType === "SIMULATION_LOSS");
  assert.ok(simulationInbox);
  const datedInbox = await updatePlanInboxItem(user.id, simulationInbox.id, {
    expectedRevision: simulationInbox.revision,
    plannedDate: now.toISOString(),
  });
  const convertedInbox = await convertPlanInboxItem(user.id, datedInbox.id, { expectedRevision: datedInbox.revision });
  assert.ok(convertedInbox.convertedTaskId);
  const rolling = await getPlanRolling(user.id, { date: "2026-07-22" });
  assert.equal(rolling.workspaceId, workspace.id);
  assert.equal(rolling.days.length, 7);
  assert.equal(rolling.tasks.filter((task) => task.id === convertedInbox.convertedTaskId).length, 1);

  const legacy = await prisma.simulationExam.create({ data: { name: "Legacy", examDate: now, targetScore: 100, actualScore: 60 } });
  const legacyBefore = await prisma.simulationExam.findUniqueOrThrow({ where: { id: legacy.id } });
  const legacyDto = await getSimulationExam(legacy.id, user.id);
  assert.equal(legacyDto.totalsSource, "legacy_fallback");
  assert.deepEqual(legacyDto.legacyDisplayTotals, { targetScore: 100, actualScore: 60 });
  assert.equal((await listSimulationExams(user.id)).some((item) => item.id === legacy.id), true);
  assert.deepEqual(await listSimulationRemediations(legacy.id, user.id), []);
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

  const report = await getPeriodicReport("week", now, user.id);
  const analytics = await getAnalyticsSummary(now, user.id);
  assert.deepEqual(report.range, analytics.range);
  assert.equal(report.metrics.effectiveMinutes, analytics.totals.weekEffectiveMinutes);
  assert.equal(report.metrics.taskCompletionRate, analytics.totals.weeklyTaskCompletionRate);
  assert.notEqual(report.weakness.source, "simulation_loss");
  const stagePlanBeforeReport = await prisma.stagePlan.findUniqueOrThrow({ where: { id: stagePlan.id } });
  const tasksBeforeReport = stableRows(await prisma.studyTask.findMany({ where: { subject: { workspaceId: workspace.id } } }));
  const reportDecision = await decidePeriodicReport({
    kind: "week",
    action: "confirm",
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
  const reportRetry = await decidePeriodicReport({
    kind: "week",
    action: "confirm",
    rangeStart: report.range.start,
    rangeEnd: report.range.end,
  }, user.id, now);
  assert.equal(reportRetry.alreadyDecided, true);
  assert.equal(await prisma.planInboxItem.count({ where: { workspaceId: workspace.id, originType: "PERIODIC_REPORT" } }), reportInboxCount);
  assert.equal(await prisma.stageAdjustmentDraft.count({ where: { workspaceId: workspace.id } }), reportDraftCount);

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
  const tasksBeforeStage = stableRows(await prisma.studyTask.findMany({ where: { subject: { workspaceId: workspace.id } } }));
  const applied = await confirmStageAdjustmentDraft(stageDraft.id, user.id);
  assert.equal(applied.status, "applied");
  const stagePlanAfter = await prisma.stagePlan.findUniqueOrThrow({ where: { id: stagePlan.id } });
  assert.equal(stagePlanAfter.goal, "补强极限并复测");
  assert.equal(stagePlanAfter.revision, stagePlan.revision + 1);
  assert.deepEqual(stableRows(await prisma.studyTask.findMany({ where: { subject: { workspaceId: workspace.id } } })), tasksBeforeStage);
  assert.equal(await prisma.planInboxItem.count({ where: { workspaceId: workspace.id, originType: "STAGE_ADJUSTMENT" } }), 2);
  await confirmStageAdjustmentDraft(stageDraft.id, user.id);
  assert.equal(await prisma.planInboxItem.count({ where: { workspaceId: workspace.id, originType: "STAGE_ADJUSTMENT" } }), 2);

  await assert.rejects(() => prisma.simulationLossItem.create({ data: { simulationSubjectResultId: saved.subjectResults[0]!.id, reason: "METHOD_ERROR", lostScore: 0.3 } }));
  assert.equal(baselineTask.id, tasksBeforeReport.find((task) => task.id === baselineTask.id)?.id);
  console.log(JSON.stringify({
    schemaVersion: "v11-m8-runtime-selftest-v2",
    status: "pass",
    database,
    checks: {
      migration8Schema: "pass",
      simulationCasAndRemediationTransaction: "pass",
      reportConfirmNoStagePlanOrTaskMutation: "pass",
      stageConfirmNoTaskMutation: "pass",
      legacyTotalsReadOnly: "pass",
      crossPageCanonicalFixture: "pass",
      workspaceIsolationAndSevenDayDto: "pass",
    },
  }, null, 2));
  console.log("PASS v11 M8 isolated PostgreSQL runtime selftest");
} finally {
  await prisma.$disconnect();
}
