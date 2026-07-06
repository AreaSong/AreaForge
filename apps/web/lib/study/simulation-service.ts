import { evaluateSimulationReadiness, type SimulationReadinessSummary } from "@areaforge/core";
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
      reviewText: composeSimulationReview(input),
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
  const modeRecommendation = chooseMode(readiness);

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
      riskConclusion: createRiskConclusion(readiness),
      focusSubjects: chooseFocusSubjects(analytics.subjects),
      intensityAdjustment: createIntensityAdjustment(modeRecommendation),
      modeRecommendation,
      taskActions: readiness.nextActions,
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

function composeSimulationReview(input: CompleteSimulationTaskInput): string {
  const lines = [
    ["目标分", input.targetScore],
    ["实际分", input.actualScore],
    ["用时", input.durationMinutes ? `${input.durationMinutes} 分钟` : undefined],
    ["空题数量", input.blankCount === undefined ? undefined : `${input.blankCount}`],
    ["失分原因", input.lossReason],
    ["心态记录", input.mindset],
    ["考后总结", input.summary],
  ];

  return lines
    .filter(([, value]) => value !== undefined && `${value}`.trim().length > 0)
    .map(([label, value]) => `${label}：${value}`)
    .join("\n");
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

function chooseMode(readiness: SimulationReadinessSummary): SimulationStageDraftDto["draft"]["modeRecommendation"] {
  if (readiness.level === "simulation_window") return "simulation_window";
  if (readiness.level === "not_ready") return "recovery";
  if (readiness.level === "warming_up") return "strengthening";
  return "steady";
}

function createRiskConclusion(readiness: SimulationReadinessSummary): string {
  switch (readiness.level) {
    case "simulation_window":
      return "阶段节点已到，目标是完成一次真实压力测试并立刻复盘。";
    case "ready":
      return "当前数据支持进入全真自测，但自测后仍必须回到错题和时间分配复盘。";
    case "warming_up":
      return "准备度处在启动区，模拟前应先压完成率、复盘率和薄弱点。";
    case "not_ready":
      return "当前不适合用分数评价自己，先恢复有效学习和最小闭环。";
  }
}

function createIntensityAdjustment(mode: SimulationStageDraftDto["draft"]["modeRecommendation"]): string {
  switch (mode) {
    case "simulation_window":
      return "不再扩新内容，按考试节奏完成模拟，然后当天写阶段日记。";
    case "recovery":
      return "降低任务数量，先做 30 到 90 分钟有效学习和错题复盘。";
    case "strengthening":
      return "保持任务量克制，优先薄弱节点、到期错题和复盘收口。";
    case "steady":
      return "维持当前节奏，可以安排一次完整模拟并补足考后总结。";
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
