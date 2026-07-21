import {
  draftStageAdjustment,
  evaluateSimulationReadiness,
  summarizeSimulationResult,
  buildSimulationRemediationGroups,
  summarizeSimulationScores,
  type SimulationLossReason,
  type StageAdjustmentDraft,
  type SimulationReadinessSummary,
  type SimulationResultSummary,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAnalyticsSummary } from "./analytics-service";
import { refreshCheckInSnapshotsForDates } from "./check-in-service";
import { applyTaskCas } from "./concurrency";
import { daysUntil } from "./date";
import { finalExamDate, simulationDate } from "./exam-dates";
import { getMotivationVault, getMotivationVaultShared, saveMotivationVault } from "./service";
import { listStageAdjustmentDrafts, listStagePlans } from "./stage-service";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import { createTaskDebtEvent } from "./task-debt-event-service";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import { serializeTask } from "./task-serializer";
import type {
  MotivationVaultDto,
  SimulationExamDto,
  StageAdjustmentDraftRecordDto,
  StagePlanDto,
  StudyTaskDto,
} from "./types";

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type SimulationDbClient = PrismaClient | Prisma.TransactionClient;

export interface CreateSimulationTaskInput {
  subjectId: string;
  syllabusNodeId?: string | null;
  title: string;
  plannedDate?: string;
  estimatedMinutes: number;
}

export interface CompleteSimulationTaskInput {
  targetScore?: string;
  actualScore?: string;
  durationMinutes?: number;
  blankCount?: number;
  lossReason?: string;
  mindset?: string;
  summary: string;
}

export interface CreateSimulationExamInput {
  name: string;
  examDate?: string;
  isFirstSynchronized?: boolean;
  targetDurationMinutes?: number;
  targetScore?: number;
}

export interface SimulationSubjectResultInput {
  subjectId: string;
  expectedRevision?: number;
  paperFullScore: number;
  targetScore: number;
  actualScore: number;
  durationMinutes?: number;
  blankQuestionCount: number;
  lossReasons: string[];
  summary?: string;
  lossItems: Array<{
    reason: SimulationLossReason;
    syllabusNodeId?: string | null;
    lostScore: number;
    note?: string | null;
  }>;
}

export interface SaveSimulationExamResultsInput {
  expectedRevision: number;
  targetDurationMinutes?: number;
  actualDurationMinutes?: number;
  targetScore?: number;
  actualScore?: number;
  blankQuestionCount?: number;
  lossReasons: string[];
  mindset?: string;
  summary: string;
  subjectResults: SimulationSubjectResultInput[];
}

export interface SimulationStageDraftDto {
  simulationNode: {
    title: string;
    date: string;
    daysToSimulation: number;
    isPhaseNode: true;
  };
  readiness: SimulationReadinessSummary;
  draft: {
    status: "local_rule_fallback";
    riskConclusion: string;
    focusSubjects: string[];
    intensityAdjustment: string;
    modeRecommendation: "recovery" | "strengthening" | "simulation_window" | "steady";
    taskActions: string[];
    risk: StageAdjustmentDraft["risk"];
    taskIntensity: StageAdjustmentDraft["taskIntensity"];
    requiresUserConfirmation: true;
    canAutoApply: false;
    privacyBoundary: string;
  };
}

export interface SimulationWorkspaceDto {
  exams: SimulationExamDto[];
  tasks: StudyTaskDto[];
  stage: SimulationStageDraftDto;
  stagePlans: StagePlanDto[];
  stageAdjustmentDrafts: StageAdjustmentDraftRecordDto[];
  motivationVault: MotivationVaultDto | null;
}

export async function getSimulationWorkspace(now = new Date()): Promise<SimulationWorkspaceDto> {
  const [exams, tasks, stage, stagePlans, stageAdjustmentDrafts, motivationVault] = await Promise.all([
    listSimulationExams(),
    listSimulationTasks(),
    getSimulationStageDraft(now),
    listStagePlans(),
    listStageAdjustmentDrafts(),
    getMotivationVaultShared(),
  ]);

  return { exams, tasks, stage, stagePlans, stageAdjustmentDrafts, motivationVault };
}

export async function listSimulationExams(actorId?: string): Promise<SimulationExamDto[]> {
  const workspace = actorId ? await resolveActiveWorkspace(actorId) : null;
  const exams = await prisma.simulationExam.findMany({
    where: workspace ? { OR: [{ workspaceId: workspace.id }, { workspaceId: null }] } : undefined,
    include: {
      subjectResults: {
        include: { subject: true, lossItems: { include: { syllabusNode: true }, orderBy: { createdAt: "asc" } } },
        orderBy: { subjectId: "asc" },
      },
    },
    orderBy: [{ examDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  return exams.map(serializeSimulationExam);
}

export async function getSimulationExam(id: string, actorId: string): Promise<SimulationExamDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const exam = await prisma.simulationExam.findFirst({
    where: { id, OR: [{ workspaceId: workspace.id }, { workspaceId: null }] },
    include: {
      subjectResults: {
        include: { subject: true, lossItems: { include: { syllabusNode: true }, orderBy: { createdAt: "asc" } } },
        orderBy: { subjectId: "asc" },
      },
    },
  });
  if (!exam) throw new ApiError("SIMULATION_EXAM_NOT_FOUND", 404);
  return serializeSimulationExam(exam);
}

export async function createSimulationExam(
  input: CreateSimulationExamInput,
  actorId: string,
): Promise<SimulationExamDto> {
  const examDate = input.examDate ? new Date(input.examDate) : simulationDate;
  const workspace = await resolveActiveWorkspace(actorId);
  const exam = await prisma.$transaction(async (tx) => {
    const created = await tx.simulationExam.create({
      data: {
        workspaceId: workspace.id,
        name: input.name,
        examDate,
        isFirstSynchronized: input.isFirstSynchronized ?? isFirstSimulationTask(examDate),
        targetDurationMinutes: input.targetDurationMinutes,
        targetScore: input.targetScore,
      },
      include: {
        subjectResults: {
          include: { subject: true, lossItems: { include: { syllabusNode: true }, orderBy: { createdAt: "asc" } } },
          orderBy: { subjectId: "asc" },
        },
      },
    });

    await audit(actorId, "SIMULATION_EXAM_CREATED", "SimulationExam", created.id, tx);
    return created;
  });

  return serializeSimulationExam(exam);
}

export async function saveSimulationExamResults(
  id: string,
  input: SaveSimulationExamResultsInput,
  actorId: string,
): Promise<SimulationExamDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const exam = await prisma.$transaction(async (tx) => {
    const existing = await tx.simulationExam.findFirst({
      where: { id, workspaceId: workspace.id },
      select: {
        id: true,
        isFirstSynchronized: true,
        targetDurationMinutes: true,
        targetScore: true,
        revision: true,
      },
    });
    if (!existing) {
      throw new ApiError("SIMULATION_EXAM_NOT_FOUND", 404);
    }
    if (input.expectedRevision !== existing.revision) {
      throw new ApiError("SIMULATION_EXAM_REVISION_CONFLICT", 409, { latest: { revision: existing.revision }, conflictFields: ["revision"] });
    }

    assertUniqueSubjectResults(input.subjectResults);
    await assertSubjectsExist(input.subjectResults.map((result) => result.subjectId), workspace.id, tx);
    await assertSimulationLossNodes(input.subjectResults, tx);
    const currentSubjectResults = await tx.simulationSubjectResult.findMany({
      where: { simulationExamId: id, subjectId: { in: input.subjectResults.map((result) => result.subjectId) } },
      select: { id: true, subjectId: true, revision: true },
    });
    const currentSubjectResultBySubjectId = new Map(currentSubjectResults.map((result) => [result.subjectId, result]));

    const scoreSummary = summarizeSimulationScores(input.subjectResults);
    const targetDurationMinutes = input.targetDurationMinutes ?? existing.targetDurationMinutes;
    const actualDurationMinutes = input.actualDurationMinutes ?? sumDefined(input.subjectResults, "durationMinutes");
    const targetScore = scoreSummary.targetScore;
    const actualScore = scoreSummary.actualScore;
    const blankQuestionCount =
      input.blankQuestionCount ?? input.subjectResults.reduce((total, result) => total + result.blankQuestionCount, 0);
    const lossReasons = normalizeLossReasons([
      ...input.lossReasons,
      ...input.subjectResults.flatMap((result) => result.lossReasons),
    ]);
    const resultSummary = summarizeStructuredSimulationResult({
      targetScore,
      actualScore,
      targetDurationMinutes,
      actualDurationMinutes,
      blankQuestionCount,
      lossReasons,
      mindset: input.mindset,
      isFirstSynchronizedSimulation: existing.isFirstSynchronized,
    });

    const examUpdate = await tx.simulationExam.updateMany({
      where: { id, workspaceId: workspace.id, revision: input.expectedRevision },
      data: {
        targetDurationMinutes,
        actualDurationMinutes,
        targetScore,
        actualScore,
        blankQuestionCount,
        lossReasons,
        mindset: normalizeOptionalText(input.mindset),
        summary: input.summary,
        reviewText: composeStructuredSimulationReview(input, resultSummary, {
          targetScore,
          actualScore,
          targetDurationMinutes,
          actualDurationMinutes,
          blankQuestionCount,
          lossReasons,
        }),
        revision: { increment: 1 },
      },
    });
    if (examUpdate.count !== 1) {
      const latest = await tx.simulationExam.findUnique({ where: { id }, select: { revision: true } });
      throw new ApiError("SIMULATION_EXAM_REVISION_CONFLICT", 409, {
        latest: latest ?? undefined,
        conflictFields: ["revision"],
      });
    }

    for (const result of input.subjectResults) {
      const current = currentSubjectResultBySubjectId.get(result.subjectId);
      let savedResult: { id: string; revision: number };
      if (!current) {
        if (result.expectedRevision != null) {
          throw new ApiError("SIMULATION_SUBJECT_REVISION_CONFLICT", 409, {
            latest: { subjectId: result.subjectId, revision: null },
            conflictFields: ["revision"],
          });
        }
        savedResult = await tx.simulationSubjectResult.create({
          data: {
            simulationExamId: id,
            subjectId: result.subjectId,
            paperFullScore: result.paperFullScore,
            targetScore: result.targetScore,
            actualScore: result.actualScore,
            durationMinutes: result.durationMinutes,
            blankQuestionCount: result.blankQuestionCount,
            lossReasons: result.lossReasons,
            summary: normalizeOptionalText(result.summary),
          },
          select: { id: true, revision: true },
        });
      } else {
        if (result.expectedRevision !== current.revision) {
          throw new ApiError("SIMULATION_SUBJECT_REVISION_CONFLICT", 409, {
            latest: { subjectId: result.subjectId, revision: current.revision },
            conflictFields: ["revision"],
          });
        }
        const subjectUpdate = await tx.simulationSubjectResult.updateMany({
          where: { id: current.id, revision: result.expectedRevision },
          data: {
            paperFullScore: result.paperFullScore,
            targetScore: result.targetScore,
            actualScore: result.actualScore,
            durationMinutes: result.durationMinutes,
            blankQuestionCount: result.blankQuestionCount,
            lossReasons: result.lossReasons,
            summary: normalizeOptionalText(result.summary),
            revision: { increment: 1 },
          },
        });
        if (subjectUpdate.count !== 1) {
          const latest = await tx.simulationSubjectResult.findUnique({ where: { id: current.id }, select: { revision: true } });
          throw new ApiError("SIMULATION_SUBJECT_REVISION_CONFLICT", 409, {
            latest: { subjectId: result.subjectId, revision: latest?.revision ?? current.revision },
            conflictFields: ["revision"],
          });
        }
        savedResult = { id: current.id, revision: current.revision + 1 };
      }
      await tx.simulationLossItem.updateMany({
        where: { simulationSubjectResultId: savedResult.id, archivedAt: null },
        data: { archivedAt: new Date(), revision: { increment: 1 } },
      });
      if (result.lossItems.length > 0) {
        await tx.simulationLossItem.createMany({
          data: result.lossItems.map((item) => ({
            simulationSubjectResultId: savedResult.id,
            reason: item.reason,
            syllabusNodeId: item.syllabusNodeId ?? null,
            lostScore: item.lostScore,
            note: normalizeOptionalText(item.note ?? undefined),
          })),
        });
      }
    }

    await audit(actorId, "SIMULATION_EXAM_RESULTS_SAVED", "SimulationExam", id, tx);

    return tx.simulationExam.findUniqueOrThrow({
      where: { id },
      include: {
        subjectResults: {
          include: { subject: true, lossItems: { include: { syllabusNode: true }, orderBy: { createdAt: "asc" } } },
          orderBy: { subjectId: "asc" },
        },
      },
    });
  });

  return serializeSimulationExam(exam);
}

export interface SimulationRemediationDto {
  originKey: string;
  subjectId: string;
  subjectName: string;
  reason: SimulationLossReason;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  lostScore: number;
  itemIds: string[];
  originVersion: number;
}

export interface SimulationRemediationSelection {
  originKey: string;
  originVersion: number;
}

export async function listSimulationRemediations(examId: string, actorId: string): Promise<SimulationRemediationDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  return loadSimulationRemediations(examId, workspace.id, prisma, true);
}

async function loadSimulationRemediations(
  examId: string,
  workspaceId: string,
  client: SimulationDbClient,
  allowLegacy: boolean,
): Promise<SimulationRemediationDto[]> {
  const exam = await client.simulationExam.findFirst({
    where: { id: examId, ...(allowLegacy ? { OR: [{ workspaceId }, { workspaceId: null }] } : { workspaceId }) },
    select: {
      revision: true,
      workspaceId: true,
      subjectResults: {
        select: {
          subjectId: true,
          revision: true,
          subject: { select: { name: true } },
          lossItems: {
            where: { archivedAt: null },
            select: {
              id: true,
              reason: true,
              syllabusNodeId: true,
              lostScore: true,
              syllabusNode: { select: { title: true } },
            },
          },
        },
      },
    },
  });
  if (!exam) throw new ApiError("SIMULATION_EXAM_NOT_FOUND", 404);
  if (exam.workspaceId == null) return [];
  const itemLookup = new Map(exam.subjectResults.flatMap((result) => result.lossItems.map((item) => [item.id, { item, result }] as const)));
  return buildSimulationRemediationGroups(exam.subjectResults.flatMap((result) => result.lossItems.map((item) => ({
    id: item.id,
    subjectId: result.subjectId,
    reason: item.reason as SimulationLossReason,
    syllabusNodeId: item.syllabusNodeId,
    lostScore: item.lostScore,
  })))).map((group) => {
    const sample = group.itemIds.length > 0 ? itemLookup.get(group.itemIds[0]!) : undefined;
    return {
      ...group,
      subjectName: sample?.result.subject.name ?? "未知科目",
      syllabusNodeTitle: sample?.item.syllabusNode?.title ?? null,
      originVersion: sample?.result.revision ?? exam.revision,
    };
  });
}

export async function addSimulationRemediationsToInbox(
  examId: string,
  actorId: string,
  selections: SimulationRemediationSelection[],
): Promise<{ created: number; reused: number }> {
  const workspace = await resolveActiveWorkspace(actorId);
  if (new Set(selections.map((selection) => selection.originKey)).size !== selections.length) {
    throw new ApiError("SIMULATION_REMEDIATION_DUPLICATE", 400);
  }

  return prisma.$transaction(async (tx) => {
    const candidates = await loadSimulationRemediations(examId, workspace.id, tx, false);
    const candidateByKey = new Map(candidates.map((candidate) => [candidate.originKey, candidate]));
    const selected = selections.map((selection) => {
      const candidate = candidateByKey.get(selection.originKey);
      if (!candidate || candidate.originVersion !== selection.originVersion) {
        throw new ApiError("SIMULATION_REMEDIATION_STALE", 409, {
          latest: candidate ?? undefined,
          conflictFields: ["originKey", "originVersion"],
        });
      }
      return candidate;
    });
    const inserted = await tx.planInboxItem.createMany({
      data: selected.map((candidate) => ({
        workspaceId: workspace.id,
        stableKey: `${candidate.originKey}:v${candidate.originVersion}`,
        originKey: candidate.originKey,
        originVersion: candidate.originVersion,
        originType: "SIMULATION_LOSS",
        originSnapshot: {
          examId,
          itemIds: candidate.itemIds,
          lostScore: candidate.lostScore,
          reason: candidate.reason,
        } as Prisma.InputJsonValue,
        title: `${candidate.subjectName}：补救 ${labelSimulationLossReason(candidate.reason)}（${candidate.lostScore} 分）`,
        subjectId: candidate.subjectId,
        primaryNodeId: candidate.syllabusNodeId,
        estimatedMinutes: candidate.lostScore >= 10 ? 60 : 30,
        priority: candidate.lostScore >= 10 ? "critical" : "high",
        type: "review",
        actorId,
      })),
      skipDuplicates: true,
    });
    return { created: inserted.count, reused: selected.length - inserted.count };
  });
}

function labelSimulationLossReason(reason: SimulationLossReason): string {
  return ({
    CONCEPT_GAP: "概念缺口", MEMORY_FORMULA: "记忆/公式", METHOD_ERROR: "方法错误",
    CALCULATION_CARELESS: "计算/粗心", TIME_ALLOCATION: "时间分配", READING_COMPREHENSION: "审题理解",
    UNFAMILIAR_PATTERN: "题型陌生", MINDSET: "心态", UNANSWERED: "未作答", OTHER: "其他",
  } satisfies Record<SimulationLossReason, string>)[reason];
}

export async function listSimulationTasks(): Promise<StudyTaskDto[]> {
  const tasks = await prisma.studyTask.findMany({
    where: {
      type: "simulation_exam",
    },
    include: {
      subject: true,
      syllabusNode: true,
    },
    orderBy: [{ plannedDate: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  return tasks.map(serializeTask);
}

export async function createSimulationTask(
  input: CreateSimulationTaskInput,
  actorId: string,
): Promise<StudyTaskDto> {
  await assertSubjectExists(input.subjectId);
  if (input.syllabusNodeId) {
    await assertSyllabusNodeBelongsToSubject(input.syllabusNodeId, input.subjectId);
  }

  const task = await prisma.$transaction(async (tx) => {
    const createdTask = await tx.studyTask.create({
      data: {
        subjectId: input.subjectId,
        syllabusNodeId: input.syllabusNodeId ?? null,
        title: input.title,
        type: "simulation_exam",
        priority: "CRITICAL",
        plannedDate: input.plannedDate ? new Date(input.plannedDate) : simulationDate,
        estimatedMinutes: input.estimatedMinutes,
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    await audit(actorId, "SIMULATION_TASK_CREATED", "StudyTask", createdTask.id, tx);
    await refreshCheckInSnapshotsForDates([createdTask.plannedDate], tx);

    return createdTask;
  });

  return serializeTask(task);
}

export async function completeSimulationTask(
  id: string,
  input: CompleteSimulationTaskInput,
  actorId: string,
): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await tx.studyTask.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        debtStatus: true,
        estimatedMinutes: true,
        plannedDate: true,
        completedAt: true,
        updatedAt: true,
      },
    });
    if (!existing || existing.type !== "simulation_exam") {
      throw new ApiError("SIMULATION_TASK_NOT_FOUND", 404);
    }
    if (!["TODO", "IN_PROGRESS", "DEFERRED"].includes(existing.status)) {
      throw new ApiError("TASK_STATE_CONFLICT", 409);
    }

    const completedAt = new Date();
    const isFirstSynchronizedSimulation = isFirstSimulationTask(existing.plannedDate);
    await applyTaskCas(tx, existing, {
      status: "DONE",
      debtStatus: "NONE",
      actualMinutes: input.durationMinutes,
      reviewText: composeSimulationReview(
        input,
        maybeSummarizeSimulationResult(input, existing.estimatedMinutes, isFirstSynchronizedSimulation),
      ),
      completedAt,
    });
    const updatedTask = await tx.studyTask.findUnique({
      where: { id },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });
    if (!updatedTask) throw new ApiError("TASK_STATE_CONFLICT", 409);

    await audit(actorId, "SIMULATION_TASK_COMPLETED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "complete",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: "完成模拟考试任务",
      metadata: {
        source: "simulation_task_complete_api",
        targetScore: input.targetScore ?? null,
        actualScore: input.actualScore ?? null,
        durationMinutes: input.durationMinutes ?? null,
        blankCount: input.blankCount ?? null,
        hasLossReason: Boolean(input.lossReason?.trim()),
        hasMindset: Boolean(input.mindset?.trim()),
        summaryProvided: Boolean(input.summary.trim()),
        isFirstSynchronizedSimulation,
        previousCompletedAt: existing.completedAt?.toISOString() ?? null,
        completedAt: completedAt.toISOString(),
      },
    }, tx);
    await refreshCheckInSnapshotsForDates([updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function getSimulationStageDraft(now = new Date()): Promise<SimulationStageDraftDto> {
  const [analytics, motivationVault] = await Promise.all([
    getAnalyticsSummary(now),
    getMotivationVaultShared(),
  ]);
  const daysToSimulation = daysUntil(simulationDate, now);
  const readiness = evaluateSimulationReadiness({
    daysToSimulation,
    weeklyEffectiveMinutes: analytics.totals.weekEffectiveMinutes,
    weeklyTaskCompletionRate: analytics.totals.weeklyTaskCompletionRate,
    reviewCompletionRate: analytics.totals.reviewCompletionRate,
    weakNodeCount: analytics.totals.weakNodeCount,
    dueMistakeCount: analytics.totals.dueMistakes,
    hasFirstSimulationDiary: Boolean(motivationVault?.firstSimulationDiary),
  });
  const stageAdjustment = draftStageAdjustment({
    stageGoal: "2026 年 12 月同步全真自测",
    taskCompletionRate: analytics.totals.weeklyTaskCompletionRate,
    subjectInvestmentBalance: calculateSubjectInvestmentBalance(analytics.subjects),
    mistakeReviewRate: calculateMistakeReviewRate(analytics.totals.totalMistakes, analytics.totals.dueMistakes),
    reviewCompletionRate: analytics.totals.reviewCompletionRate,
    currentStreakDays: analytics.totals.streakDays,
    breakCount: analytics.totals.missedDays,
    lowConversionCount: analytics.totals.lowConversionCount,
    weakSubjectNames: chooseFocusSubjects(analytics.subjects),
    simulationScoreRate: null,
    daysToFinal: daysUntil(finalExamDate, now),
  });

  return {
    simulationNode: {
      title: "2026 年 12 月同步全真自测",
      date: simulationDate.toISOString(),
      daysToSimulation,
      isPhaseNode: true,
    },
    readiness,
    draft: {
      status: "local_rule_fallback",
      riskConclusion: stageAdjustment.riskConclusion,
      focusSubjects: stageAdjustment.focusSubjects,
      intensityAdjustment: stageAdjustment.nextStageEmphasis,
      modeRecommendation: mapStageAdjustmentMode(stageAdjustment.mode, readiness),
      taskActions: [
        ...readiness.nextActions,
        ...stageAdjustment.taskAdjustmentActions.map(labelStageTaskAction),
      ].slice(0, 6),
      risk: stageAdjustment.risk,
      taskIntensity: stageAdjustment.taskIntensity,
      requiresUserConfirmation: stageAdjustment.requiresUserConfirmation,
      canAutoApply: stageAdjustment.canAutoApply,
      privacyBoundary: "本草稿由本地规则生成，不调用外部 AI，不发送动机档案、完整情绪记录或复盘正文。",
    },
  };
}

export async function saveFirstSimulationDiary(
  firstSimulationDiary: string,
  actorId: string,
): Promise<MotivationVaultDto> {
  const existing = await getMotivationVault();

  return saveMotivationVault(
    {
      whyStarted: existing?.whyStarted ?? undefined,
      neverReturnTo: existing?.neverReturnTo ?? undefined,
      futureSelf: existing?.futureSelf ?? undefined,
      messageToFuture: existing?.messageToFuture ?? undefined,
      firstSimulationDiary,
    },
    actorId,
  );
}

function composeSimulationReview(
  input: CompleteSimulationTaskInput,
  resultSummary: SimulationResultSummary | null,
): string {
  const lines = [
    ["目标分", input.targetScore],
    ["实际分", input.actualScore],
    ["用时", input.durationMinutes ? `${input.durationMinutes} 分钟` : undefined],
    ["空题数量", input.blankCount === undefined ? undefined : `${input.blankCount}`],
    ["失分原因", input.lossReason],
    ["心态记录", input.mindset],
    ["规则复盘", resultSummary ? formatSimulationResultSummary(resultSummary) : undefined],
    ["考后总结", input.summary],
  ];

  return lines
    .filter(([, value]) => value !== undefined && `${value}`.trim().length > 0)
    .map(([label, value]) => `${label}：${value}`)
    .join("\n");
}

function composeStructuredSimulationReview(
  input: SaveSimulationExamResultsInput,
  resultSummary: SimulationResultSummary | null,
  aggregate: {
    targetScore?: number | null;
    actualScore?: number | null;
    targetDurationMinutes?: number | null;
    actualDurationMinutes?: number | null;
    blankQuestionCount: number;
    lossReasons: string[];
  },
): string {
  const lines = [
    ["目标分", formatMaybeNumber(aggregate.targetScore)],
    ["实际分", formatMaybeNumber(aggregate.actualScore)],
    ["目标用时", aggregate.targetDurationMinutes ? `${aggregate.targetDurationMinutes} 分钟` : undefined],
    ["实际用时", aggregate.actualDurationMinutes ? `${aggregate.actualDurationMinutes} 分钟` : undefined],
    ["空题数量", `${aggregate.blankQuestionCount}`],
    ["失分原因", aggregate.lossReasons.join("、")],
    ["心态记录", input.mindset],
    ["规则复盘", resultSummary ? formatSimulationResultSummary(resultSummary) : undefined],
    ["考后总结", input.summary],
  ];

  return lines
    .filter(([, value]) => value !== undefined && `${value}`.trim().length > 0)
    .map(([label, value]) => `${label}：${value}`)
    .join("\n");
}

function maybeSummarizeSimulationResult(
  input: CompleteSimulationTaskInput,
  targetDurationMinutes: number,
  isFirstSynchronizedSimulation: boolean,
): SimulationResultSummary | null {
  const targetScore = parseScore(input.targetScore);
  const actualScore = parseScore(input.actualScore);
  if (targetScore == null || actualScore == null) return null;

  return summarizeSimulationResult({
    targetScore,
    actualScore,
    targetDurationMinutes,
    actualDurationMinutes: input.durationMinutes ?? targetDurationMinutes,
    blankQuestionCount: input.blankCount ?? 0,
    lossReasons: splitLossReasons(input.lossReason),
    mood: input.mindset,
    isFirstSynchronizedSimulation,
  });
}

function summarizeStructuredSimulationResult(input: {
  targetScore?: number | null;
  actualScore?: number | null;
  targetDurationMinutes?: number | null;
  actualDurationMinutes?: number | null;
  blankQuestionCount: number;
  lossReasons: string[];
  mindset?: string;
  isFirstSynchronizedSimulation: boolean;
}): SimulationResultSummary | null {
  if (input.targetScore == null || input.actualScore == null) return null;

  return summarizeSimulationResult({
    targetScore: input.targetScore,
    actualScore: input.actualScore,
    targetDurationMinutes: input.targetDurationMinutes ?? input.actualDurationMinutes ?? 180,
    actualDurationMinutes: input.actualDurationMinutes ?? input.targetDurationMinutes ?? 180,
    blankQuestionCount: input.blankQuestionCount,
    lossReasons: input.lossReasons,
    mood: input.mindset,
    isFirstSynchronizedSimulation: input.isFirstSynchronizedSimulation,
  });
}

function parseScore(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

function splitLossReasons(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,，;；、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isFirstSimulationTask(plannedDate: Date): boolean {
  return Math.abs(plannedDate.getTime() - simulationDate.getTime()) <= 1000 * 60 * 60 * 24 * 7;
}

function formatSimulationResultSummary(summary: SimulationResultSummary): string {
  return [
    `表现：${labelSimulationPerformance(summary.performance)}，分差 ${summary.scoreGap >= 0 ? "+" : ""}${summary.scoreGap}，达成率 ${Math.round(summary.scoreRate * 100)}%。`,
    `时间压力：${labelTimePressure(summary.timePressure)}。`,
    `主要短板：${summary.mainShortfalls.join("、")}。`,
    `下一步：${summary.nextActions.join(" / ")}`,
    summary.shouldRecalibratePlan ? "需要重校准阶段计划：是。" : "需要重校准阶段计划：否。",
    `考后必填：${summary.postSimulationRequiredFields.join("、")}。`,
  ].join("\n");
}

function labelSimulationPerformance(performance: SimulationResultSummary["performance"]): string {
  switch (performance) {
    case "above_target":
      return "超过目标";
    case "near_target":
      return "接近目标";
    case "below_target":
      return "低于目标";
    case "collapse":
      return "明显崩盘";
  }
}

function labelTimePressure(pressure: SimulationResultSummary["timePressure"]): string {
  switch (pressure) {
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
  }
}

async function assertSubjectExists(subjectId: string): Promise<void> {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { id: true },
  });

  if (!subject) {
    throw new ApiError("SUBJECT_NOT_FOUND", 404);
  }
}

async function assertSubjectsExist(subjectIds: string[], workspaceId: string, client: SimulationDbClient): Promise<void> {
  const uniqueSubjectIds = Array.from(new Set(subjectIds));
  const count = await client.subject.count({
    where: {
      id: { in: uniqueSubjectIds },
      workspaceId,
      archivedAt: null,
    },
  });

  if (count !== uniqueSubjectIds.length) {
    throw new ApiError("SUBJECT_NOT_FOUND", 404);
  }
}

function assertUniqueSubjectResults(results: SimulationSubjectResultInput[]): void {
  const seen = new Set<string>();
  for (const result of results) {
    if (seen.has(result.subjectId)) {
      throw new ApiError("SIMULATION_SUBJECT_DUPLICATE", 400);
    }
    seen.add(result.subjectId);
  }
}

function chooseFocusSubjects(
  subjects: Array<{
    subjectName: string;
    effectiveMinutes: number;
    share: number;
  }>,
): string[] {
  const focus = [...subjects]
    .sort((left, right) => {
      if (left.effectiveMinutes === right.effectiveMinutes) {
        return left.share - right.share;
      }
      return left.effectiveMinutes - right.effectiveMinutes;
    })
    .slice(0, 3)
    .map((subject) => subject.subjectName);

  return focus.length > 0 ? focus : ["数学", "英语", "408"];
}

function calculateSubjectInvestmentBalance(subjects: Array<{ share: number }>): number {
  const maxShare = Math.max(0, ...subjects.map((subject) => subject.share));
  return Math.max(0, Math.min(1, 1 - maxShare / 100));
}

function calculateMistakeReviewRate(totalMistakes: number, dueMistakes: number): number {
  if (totalMistakes <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - dueMistakes / totalMistakes));
}

function mapStageAdjustmentMode(
  mode: StageAdjustmentDraft["mode"],
  readiness: SimulationReadinessSummary,
): SimulationStageDraftDto["draft"]["modeRecommendation"] {
  if (readiness.level === "simulation_window") return "simulation_window";
  switch (mode) {
    case "recovery":
      return "recovery";
    case "strengthen":
      return "strengthening";
    case "sprint":
      return "simulation_window";
    case "maintain":
      return "steady";
  }
}

function labelStageTaskAction(action: StageAdjustmentDraft["taskAdjustmentActions"][number]): string {
  switch (action) {
    case "split":
      return "把过大的任务拆小，只保留能完成的最小动作。";
    case "defer":
      return "延期低优先级任务，避免挤占有效学习。";
    case "drop":
      return "放弃当前阶段低价值任务，先保关键目标。";
    case "convert_review":
      return "把低转化任务改成复习或错题任务。";
    case "simulate":
      return "安排一次完整模拟，并当天完成复盘。";
    case "retest":
      return "对薄弱节点安排复测，补掌握证明。";
  }
}

function serializeSimulationExam(exam: {
  id: string;
  name: string;
  examDate: Date;
  isFirstSynchronized: boolean;
  targetDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  targetScore: number | null;
  actualScore: number | null;
  blankQuestionCount: number;
  lossReasons: unknown;
  mindset: string | null;
  summary: string | null;
  reviewText: string | null;
  createdAt: Date;
  updatedAt: Date;
  revision: number;
  subjectResults: Array<{
    id: string;
    simulationExamId: string;
    subjectId: string;
    paperFullScore: number | null;
    targetScore: number | null;
    actualScore: number | null;
    durationMinutes: number | null;
    blankQuestionCount: number;
    lossReasons: unknown;
    summary: string | null;
    revision: number;
    lossItems: Array<{
      id: string;
      reason: string;
      syllabusNodeId: string | null;
      lostScore: number;
      note: string | null;
      revision: number;
      archivedAt: Date | null;
      syllabusNode: { title: string } | null;
    }>;
    subject: {
      name: string;
      color: string;
    };
  }>;
}): SimulationExamDto {
  const hasLegacyTotals = exam.targetScore != null || exam.actualScore != null || exam.lossReasons != null;
  const totalsSource = exam.subjectResults.length > 0 || !hasLegacyTotals ? "subject_sum" : "legacy_fallback";
  const scoreSummary = totalsSource === "subject_sum"
    ? summarizeSimulationScores(exam.subjectResults.map((result) => ({
        subjectId: result.subjectId,
        paperFullScore: result.paperFullScore ?? Math.max(result.targetScore ?? 0, result.actualScore ?? 0),
        targetScore: result.targetScore ?? 0,
        actualScore: result.actualScore ?? 0,
      })))
    : null;
  const warnings = exam.subjectResults.flatMap((result) => {
    if (result.paperFullScore == null || result.actualScore == null) return [];
    const structuredLoss = result.lossItems
      .filter((item) => item.archivedAt == null)
      .reduce((sum, item) => sum + item.lostScore, 0);
    const realLoss = Math.max(0, result.paperFullScore - result.actualScore);
    return Math.abs(structuredLoss - realLoss) >= 0.25
      ? [`${result.subject.name}：结构化失分 ${structuredLoss} 分与真实丢分 ${realLoss} 分不一致`]
      : [];
  });
  return {
    id: exam.id,
    name: exam.name,
    examDate: exam.examDate.toISOString(),
    isFirstSynchronized: exam.isFirstSynchronized,
    targetDurationMinutes: exam.targetDurationMinutes,
    actualDurationMinutes: exam.actualDurationMinutes,
    targetScore: scoreSummary?.targetScore ?? exam.targetScore,
    actualScore: scoreSummary?.actualScore ?? exam.actualScore,
    blankQuestionCount: exam.blankQuestionCount,
    lossReasons: parseLossReasons(exam.lossReasons),
    mindset: exam.mindset,
    summary: exam.summary,
    reviewText: exam.reviewText,
    createdAt: exam.createdAt.toISOString(),
    updatedAt: exam.updatedAt.toISOString(),
    revision: exam.revision,
    totalsSource,
    legacyDisplayTotals: totalsSource === "legacy_fallback" ? { targetScore: exam.targetScore, actualScore: exam.actualScore } : null,
    warnings,
    subjectResults: exam.subjectResults.map((result) => ({
      id: result.id,
      simulationExamId: result.simulationExamId,
      subjectId: result.subjectId,
      subjectName: result.subject.name,
      subjectColor: result.subject.color,
      paperFullScore: result.paperFullScore,
      targetScore: result.targetScore,
      actualScore: result.actualScore,
      durationMinutes: result.durationMinutes,
      blankQuestionCount: result.blankQuestionCount,
      lossReasons: parseLossReasons(result.lossReasons),
      summary: result.summary,
      revision: result.revision,
      lossItems: result.lossItems.map((item) => ({
        id: item.id,
        reason: item.reason as SimulationExamDto["subjectResults"][number]["lossItems"][number]["reason"],
        syllabusNodeId: item.syllabusNodeId,
        syllabusNodeTitle: item.syllabusNode?.title ?? null,
        lostScore: item.lostScore,
        note: item.note,
        revision: item.revision,
        archivedAt: item.archivedAt?.toISOString() ?? null,
      })),
    })),
  };
}

async function assertSimulationLossNodes(
  results: SimulationSubjectResultInput[],
  client: SimulationDbClient,
): Promise<void> {
  for (const result of results) {
    const nodeIds = Array.from(new Set(result.lossItems.map((item) => item.syllabusNodeId).filter((id): id is string => Boolean(id))));
    if (nodeIds.length === 0) continue;
    const count = await client.syllabusNode.count({
      where: { id: { in: nodeIds }, subjectId: result.subjectId, archivedAt: null },
    });
    if (count !== nodeIds.length) throw new ApiError("SIMULATION_LOSS_NODE_SUBJECT_MISMATCH", 400);
  }
}

function sumDefined(items: SimulationSubjectResultInput[], key: keyof SimulationSubjectResultInput): number | undefined {
  const values = items.map((item) => item[key]).filter((value): value is number => typeof value === "number");
  if (values.length === 0) return undefined;
  return values.reduce((total, value) => total + value, 0);
}

function normalizeLossReasons(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 20);
}

function parseLossReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeOptionalText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatMaybeNumber(value: number | null | undefined): string | undefined {
  if (value == null) return undefined;
  return Number.isInteger(value) ? `${value}` : `${Math.round(value * 10) / 10}`;
}

function toTaskDebtEventState(task: {
  status: DbTaskStatus;
  debtStatus: string;
}) {
  return {
    status: task.status,
    debtStatus: task.debtStatus,
  };
}

async function audit(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  client: SimulationDbClient = prisma,
): Promise<void> {
  await client.auditEvent.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
    },
  });
}
