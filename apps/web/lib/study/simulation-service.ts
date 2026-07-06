import {
  draftStageAdjustment,
  evaluateSimulationReadiness,
  summarizeSimulationResult,
  type StageAdjustmentDraft,
  type SimulationReadinessSummary,
  type SimulationResultSummary,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAnalyticsSummary } from "./analytics-service";
import { daysUntil } from "./date";
import { getMotivationVault, saveMotivationVault } from "./service";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import type { MotivationVaultDto, StudyTaskDto } from "./types";

const simulationDate = new Date("2026-12-20T08:30:00+08:00");

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type DbTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

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
  tasks: StudyTaskDto[];
  stage: SimulationStageDraftDto;
  motivationVault: MotivationVaultDto | null;
}

export async function getSimulationWorkspace(now = new Date()): Promise<SimulationWorkspaceDto> {
  const [tasks, stage, motivationVault] = await Promise.all([
    listSimulationTasks(),
    getSimulationStageDraft(now),
    getMotivationVault(),
  ]);

  return { tasks, stage, motivationVault };
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

  const task = await prisma.studyTask.create({
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

  await audit(actorId, "SIMULATION_TASK_CREATED", "StudyTask", task.id);
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
      estimatedMinutes: true,
      plannedDate: true,
    },
  });

  if (!existing || existing.type !== "simulation_exam") {
    throw new ApiError("SIMULATION_TASK_NOT_FOUND", 404);
  }

  const task = await prisma.studyTask.update({
    where: { id },
    data: {
      status: "DONE",
      debtStatus: "NONE",
      actualMinutes: input.durationMinutes,
      reviewText: composeSimulationReview(
        input,
        maybeSummarizeSimulationResult(input, existing.estimatedMinutes, isFirstSimulationTask(existing.plannedDate)),
      ),
      completedAt: new Date(),
    },
    include: {
      subject: true,
      syllabusNode: true,
    },
  });

  await audit(actorId, "SIMULATION_TASK_COMPLETED", "StudyTask", task.id);
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

function serializeTask(task: {
  id: string;
  subjectId: string;
  syllabusNodeId: string | null;
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

async function audit(actorId: string, action: string, entityType: string, entityId: string): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
    },
  });
}
