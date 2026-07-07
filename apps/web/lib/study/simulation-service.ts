import {
  draftStageAdjustment,
  evaluateSimulationReadiness,
  summarizeSimulationResult,
  type StageAdjustmentDraft,
  type SimulationReadinessSummary,
  type SimulationResultSummary,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAnalyticsSummary } from "./analytics-service";
import { refreshCheckInSnapshotsForDates } from "./check-in-service";
import { daysUntil } from "./date";
import { getMotivationVault, saveMotivationVault } from "./service";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import { createTaskDebtEvent } from "./task-debt-event-service";
import type { MotivationVaultDto, SimulationExamDto, StudyTaskDto } from "./types";

const simulationDate = new Date("2026-12-20T08:30:00+08:00");

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type DbTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
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
  targetScore?: number;
  actualScore?: number;
  durationMinutes?: number;
  blankQuestionCount: number;
  lossReasons: string[];
  summary?: string;
}

export interface SaveSimulationExamResultsInput {
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
  motivationVault: MotivationVaultDto | null;
}

export async function getSimulationWorkspace(now = new Date()): Promise<SimulationWorkspaceDto> {
  const [exams, tasks, stage, motivationVault] = await Promise.all([
    listSimulationExams(),
    listSimulationTasks(),
    getSimulationStageDraft(now),
    getMotivationVault(),
  ]);

  return { exams, tasks, stage, motivationVault };
}

export async function listSimulationExams(): Promise<SimulationExamDto[]> {
  const exams = await prisma.simulationExam.findMany({
    include: {
      subjectResults: {
        include: { subject: true },
        orderBy: { subjectId: "asc" },
      },
    },
    orderBy: [{ examDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  return exams.map(serializeSimulationExam);
}

export async function createSimulationExam(
  input: CreateSimulationExamInput,
  actorId: string,
): Promise<SimulationExamDto> {
  const examDate = input.examDate ? new Date(input.examDate) : simulationDate;
  const exam = await prisma.$transaction(async (tx) => {
    const created = await tx.simulationExam.create({
      data: {
        name: input.name,
        examDate,
        isFirstSynchronized: input.isFirstSynchronized ?? isFirstSimulationTask(examDate),
        targetDurationMinutes: input.targetDurationMinutes,
        targetScore: input.targetScore,
      },
      include: {
        subjectResults: {
          include: { subject: true },
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
  const exam = await prisma.$transaction(async (tx) => {
    const existing = await tx.simulationExam.findUnique({
      where: { id },
      select: {
        id: true,
        isFirstSynchronized: true,
        targetDurationMinutes: true,
        targetScore: true,
      },
    });
    if (!existing) {
      throw new ApiError("SIMULATION_EXAM_NOT_FOUND", 404);
    }

    assertUniqueSubjectResults(input.subjectResults);
    await assertSubjectsExist(input.subjectResults.map((result) => result.subjectId), tx);

    const targetDurationMinutes = input.targetDurationMinutes ?? existing.targetDurationMinutes;
    const actualDurationMinutes = input.actualDurationMinutes ?? sumDefined(input.subjectResults, "durationMinutes");
    const targetScore = input.targetScore ?? sumDefined(input.subjectResults, "targetScore") ?? existing.targetScore;
    const actualScore = input.actualScore ?? sumDefined(input.subjectResults, "actualScore");
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

    await tx.simulationExam.update({
      where: { id },
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
      },
      include: {
        subjectResults: {
          include: { subject: true },
          orderBy: { subjectId: "asc" },
        },
      },
    });

    for (const result of input.subjectResults) {
      await tx.simulationSubjectResult.upsert({
        where: {
          simulationExamId_subjectId: {
            simulationExamId: id,
            subjectId: result.subjectId,
          },
        },
        create: {
          simulationExamId: id,
          subjectId: result.subjectId,
          targetScore: result.targetScore,
          actualScore: result.actualScore,
          durationMinutes: result.durationMinutes,
          blankQuestionCount: result.blankQuestionCount,
          lossReasons: result.lossReasons,
          summary: normalizeOptionalText(result.summary),
        },
        update: {
          targetScore: result.targetScore,
          actualScore: result.actualScore,
          durationMinutes: result.durationMinutes,
          blankQuestionCount: result.blankQuestionCount,
          lossReasons: result.lossReasons,
          summary: normalizeOptionalText(result.summary),
        },
      });
    }

    await audit(actorId, "SIMULATION_EXAM_RESULTS_SAVED", "SimulationExam", id, tx);

    return tx.simulationExam.findUniqueOrThrow({
      where: { id },
      include: {
        subjectResults: {
          include: { subject: true },
          orderBy: { subjectId: "asc" },
        },
      },
    });
  });

  return serializeSimulationExam(exam);
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
  const existing = await prisma.studyTask.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      status: true,
      debtStatus: true,
      estimatedMinutes: true,
      plannedDate: true,
      completedAt: true,
    },
  });

  if (!existing || existing.type !== "simulation_exam") {
    throw new ApiError("SIMULATION_TASK_NOT_FOUND", 404);
  }

  const task = await prisma.$transaction(async (tx) => {
    const completedAt = new Date();
    const isFirstSynchronizedSimulation = isFirstSimulationTask(existing.plannedDate);
    const updatedTask = await tx.studyTask.update({
      where: { id },
      data: {
        status: "DONE",
        debtStatus: "NONE",
        actualMinutes: input.durationMinutes,
        reviewText: composeSimulationReview(
          input,
          maybeSummarizeSimulationResult(input, existing.estimatedMinutes, isFirstSynchronizedSimulation),
        ),
        completedAt,
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

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
    getMotivationVault(),
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
    daysToFinal: daysUntil(new Date("2027-12-20T08:30:00+08:00"), now),
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

async function assertSubjectsExist(subjectIds: string[], client: SimulationDbClient): Promise<void> {
  const uniqueSubjectIds = Array.from(new Set(subjectIds));
  const count = await client.subject.count({
    where: {
      id: { in: uniqueSubjectIds },
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
  subjectResults: Array<{
    id: string;
    simulationExamId: string;
    subjectId: string;
    targetScore: number | null;
    actualScore: number | null;
    durationMinutes: number | null;
    blankQuestionCount: number;
    lossReasons: unknown;
    summary: string | null;
    subject: {
      name: string;
      color: string;
    };
  }>;
}): SimulationExamDto {
  return {
    id: exam.id,
    name: exam.name,
    examDate: exam.examDate.toISOString(),
    isFirstSynchronized: exam.isFirstSynchronized,
    targetDurationMinutes: exam.targetDurationMinutes,
    actualDurationMinutes: exam.actualDurationMinutes,
    targetScore: exam.targetScore,
    actualScore: exam.actualScore,
    blankQuestionCount: exam.blankQuestionCount,
    lossReasons: parseLossReasons(exam.lossReasons),
    mindset: exam.mindset,
    summary: exam.summary,
    reviewText: exam.reviewText,
    createdAt: exam.createdAt.toISOString(),
    updatedAt: exam.updatedAt.toISOString(),
    subjectResults: exam.subjectResults.map((result) => ({
      id: result.id,
      simulationExamId: result.simulationExamId,
      subjectId: result.subjectId,
      subjectName: result.subject.name,
      subjectColor: result.subject.color,
      targetScore: result.targetScore,
      actualScore: result.actualScore,
      durationMinutes: result.durationMinutes,
      blankQuestionCount: result.blankQuestionCount,
      lossReasons: parseLossReasons(result.lossReasons),
      summary: result.summary,
    })),
  };
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

function serializeTask(task: {
  id: string;
  subjectId: string;
  syllabusNodeId: string | null;
  parentTaskId: string | null;
  title: string;
  type: string;
  status: DbTaskStatus;
  priority: DbTaskPriority;
  debtStatus: string;
  plannedDate: Date;
  estimatedMinutes: number;
  actualMinutes: number;
  reviewText: string | null;
  completedAt: Date | null;
  subject: {
    name: string;
    color: string;
  };
  syllabusNode?: {
    title: string;
  } | null;
}): StudyTaskDto {
  return {
    id: task.id,
    subjectId: task.subjectId,
    parentTaskId: task.parentTaskId,
    subjectName: task.subject.name,
    subjectColor: task.subject.color,
    syllabusNodeId: task.syllabusNodeId,
    syllabusNodeTitle: task.syllabusNode?.title ?? null,
    title: task.title,
    type: task.type,
    status: fromDbTaskStatus(task.status),
    priority: fromDbPriority(task.priority),
    debtStatus: task.debtStatus,
    plannedDate: task.plannedDate.toISOString(),
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
    reviewText: task.reviewText,
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

function fromDbPriority(priority: DbTaskPriority): StudyTaskDto["priority"] {
  return priority.toLowerCase() as StudyTaskDto["priority"];
}

function fromDbTaskStatus(status: DbTaskStatus): StudyTaskDto["status"] {
  switch (status) {
    case "TODO":
      return "todo";
    case "IN_PROGRESS":
      return "in_progress";
    case "DONE":
      return "done";
    case "SKIPPED":
      return "skipped";
    case "DEFERRED":
      return "deferred";
  }
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
