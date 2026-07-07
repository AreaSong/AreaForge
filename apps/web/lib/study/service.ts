import {
  buildDailyCheckInSnapshot,
  createDashboardSnapshot,
  createRecoveryPlan,
  evaluateMotivationWake,
  evaluateStageLevel,
  evaluateDailyCheckIn,
  getTimerElapsedSeconds,
  normalizeStudyCloseout,
  rankRecoveryTaskCandidates,
  suggestTaskDebtReorder,
  type DashboardInput,
  type RiskState,
  type StudyTaskInput,
  type TaskDebtReorderPressure,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { daysUntil, getNextStudyDayStart, getStudyDayKey, getStudyDayRange } from "./date";
import {
  listCheckInSnapshotsInRange,
  refreshCheckInSnapshotsForDates,
} from "./check-in-service";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import { createTaskDebtEvent } from "./task-debt-event-service";
import type {
  DailyReviewDto,
  MotivationVaultDto,
  StudySessionDto,
  StudyTaskDto,
  SubjectDto,
  TaskDebtReorderDto,
  SyllabusOverviewDto,
  TodayDashboardDto,
} from "./types";

const finalExamDate = new Date("2027-12-20T08:30:00+08:00");
const simulationDate = new Date("2026-12-20T08:30:00+08:00");

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type DbTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type DbStudySessionStatus = "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELED";
type StudyDbClient = PrismaClient | Prisma.TransactionClient;

export interface CreateTaskInput {
  subjectId: string;
  syllabusNodeId?: string | null;
  title: string;
  type: string;
  priority: "low" | "medium" | "high" | "critical";
  plannedDate?: string;
  estimatedMinutes: number;
}

export interface UpdateTaskInput {
  subjectId?: string;
  syllabusNodeId?: string | null;
  title?: string;
  type?: string;
  priority?: "low" | "medium" | "high" | "critical";
  plannedDate?: string;
  estimatedMinutes?: number;
  reviewText?: string | null;
}

export interface EndSessionInput {
  qualityScore: number;
  isEffective: boolean;
  understandingLevel: string;
  minimalOutput: string;
  nextAction: string;
  producedNote: boolean;
  producedMistake: boolean;
  note?: string;
  completeTask: boolean;
}

export interface RecoverTaskInput {
  plannedDate?: string;
  reviewText?: string;
}

export interface SplitTaskInput {
  title: string;
  plannedDate?: string;
  estimatedMinutes: number;
  reviewText?: string;
}

export interface ConvertTaskToReviewInput {
  plannedDate?: string;
  estimatedMinutes?: number;
  reviewText?: string;
}

export interface SaveReviewInput {
  summary: string;
  lostControl?: string;
  keepAction: string;
  tomorrowMinimum: string;
  mood?: string;
}

export interface SaveMotivationVaultInput {
  whyStarted?: string;
  neverReturnTo?: string;
  futureSelf?: string;
  messageToFuture?: string;
  firstSimulationDiary?: string;
}

export async function getTodayDashboard(now = new Date()): Promise<TodayDashboardDto> {
  const day = getStudyDayRange(now);
  const recentStart = new Date(day.start.getTime() - 60 * 24 * 60 * 60 * 1000);
  const weeklyStart = new Date(day.start.getTime() - 6 * 24 * 60 * 60 * 1000);

  const [
    subjects,
    tasks,
    todaySessions,
    activeSession,
    review,
    debtCount,
    debtTasks,
    debtReorderTasks,
    recentSessions,
    checkInSnapshots,
    motivationVault,
  ] = await Promise.all([
    prisma.subject.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        syllabusNodes: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    }),
    prisma.studyTask.findMany({
      where: {
        plannedDate: {
          gte: day.start,
          lt: day.end,
        },
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    }),
    prisma.studySession.findMany({
      where: {
        startedAt: {
          gte: day.start,
          lt: day.end,
        },
      },
      include: {
        subject: true,
        task: true,
        syllabusNode: true,
      },
      orderBy: { startedAt: "asc" },
    }),
    prisma.studySession.findFirst({
      where: {
        status: {
          in: ["RUNNING", "PAUSED"],
        },
      },
      include: {
        subject: true,
        task: true,
        syllabusNode: true,
      },
      orderBy: { startedAt: "desc" },
    }),
    prisma.dailyReview.findUnique({
      where: { reviewDate: day.start },
    }),
    prisma.studyTask.count({
      where: {
        plannedDate: {
          lt: day.start,
        },
        status: {
          notIn: ["DONE", "SKIPPED"],
        },
      },
    }),
    prisma.studyTask.findMany({
      where: {
        plannedDate: {
          lt: day.start,
        },
        status: {
          notIn: ["DONE", "SKIPPED"],
        },
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
      orderBy: [{ priority: "desc" }, { plannedDate: "asc" }],
      take: 5,
    }),
    prisma.studyTask.findMany({
      where: {
        plannedDate: {
          lt: day.start,
        },
        status: {
          notIn: ["DONE", "SKIPPED"],
        },
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
      orderBy: [{ priority: "desc" }, { plannedDate: "asc" }],
      take: 12,
    }),
    prisma.studySession.findMany({
      where: {
        startedAt: {
          gte: recentStart,
          lt: day.end,
        },
        status: "COMPLETED",
        isEffective: true,
      },
      select: {
        startedAt: true,
        effectiveMinutes: true,
      },
    }),
    listCheckInSnapshotsInRange(recentStart, day.end),
    prisma.motivationVault.findFirst({
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const sessionDtos = todaySessions.map(serializeSession);
  const taskDtos = tasks.map(serializeTask);
  const debtTaskDtos = debtTasks.map(serializeTask);
  const debtReorderTaskDtos = debtReorderTasks.map(serializeTask);
  const todayMinutes = sumTodayMinutes(sessionDtos, activeSession ? serializeSession(activeSession) : null, now);
  const derivedDailySnapshot = buildDailyCheckInSnapshot({
    studyDate: day.key,
    sessions: sessionDtos.map(toCheckInSnapshotSession),
    tasks: taskDtos.map((task) => ({ status: task.status })),
    reviewSubmitted: Boolean(review),
  });
  const dailySnapshot = checkInSnapshots.get(day.key) ?? derivedDailySnapshot;
  const effectiveMinutes = dailySnapshot.effectiveMinutes;
  const effectiveSessionCount = dailySnapshot.effectiveSessionCount;
  const lowConversionCount = dailySnapshot.lowConversionCount;
  const latestCompletedSession = getLatestCompletedSession(sessionDtos);
  const taskCompletionRate = dailySnapshot.taskCompletionRate;
  const streakDays = getEffectiveStudyStreak(recentSessions, checkInSnapshots, now);
  const missedDays = Math.max(0, Math.min(7, 7 - streakDays));
  const recentEffectiveMinutes = sumEffectiveMinutesByStudyDay(weeklyStart, 7, recentSessions, checkInSnapshots);
  const syllabusProgress = getOverallSyllabusProgress(subjects);

  const dashboardInput: DashboardInput = {
    targetExamDate: finalExamDate,
    simulationDate,
    todayMinutes,
    effectiveMinutes,
    taskCompletionRate,
    streakDays,
    missedDays,
    debtCount,
    daysToFinal: daysUntil(finalExamDate, now),
    daysToSimulation: daysUntil(simulationDate, now),
    tasks: taskDtos.map(toCoreTask),
  };

  const snapshot = createDashboardSnapshot(dashboardInput);
  const stage = evaluateStageLevel({
    streakDays,
    todayEffectiveMinutes: effectiveMinutes,
    recentEffectiveMinutes,
    taskCompletionRate,
    syllabusProgress,
    daysToFinal: dashboardInput.daysToFinal,
  });
  const motivationWake = evaluateMotivationWake({
    hasVault: Boolean(motivationVault),
    riskState: snapshot.riskState,
    missedDays,
    debtCount,
    daysToSimulation: dashboardInput.daysToSimulation,
    hasMajorReview: isMajorReview(review),
    todayMood: review?.mood,
  });
  const checkIn = evaluateDailyCheckIn({
    effectiveMinutes,
    effectiveSessionCount,
    reviewSubmitted: dailySnapshot.reviewSubmitted,
    taskCompletionRate,
  });
  const recoveryTaskCandidates = getRecoveryTaskCandidates(taskDtos, debtTaskDtos);
  const recovery = createRecoveryPlan({
    riskState: snapshot.riskState,
    debtCount,
    missedDays,
    effectiveMinutes,
    topTask: recoveryTaskCandidates[0] ? toCoreTask(recoveryTaskCandidates[0]) : snapshot.topTasks[0],
  });
  const visibleRecoveryTasks = recovery.active
    ? recoveryTaskCandidates.slice(0, recovery.visibleTaskLimit)
    : taskDtos;
  const debtReorder = createTaskDebtReorder({
    tasks: debtReorderTaskDtos,
    dayStart: day.start,
    pressure: determineDebtReorderPressure(snapshot.riskState, stage.pressure, recovery.active),
    availableMinutes: determineDebtReorderAvailableMinutes(stage.pressure, recovery.active, recovery.minimumMinutes),
  });

  return {
    studyDay: {
      key: day.key,
      start: day.start.toISOString(),
      end: day.end.toISOString(),
    },
    metrics: {
      daysToSimulation: dashboardInput.daysToSimulation,
      daysToFinal: dashboardInput.daysToFinal,
      todayMinutes,
      effectiveMinutes,
      taskCompletionRate,
      streakDays,
      missedDays,
      debtCount,
    },
    snapshot,
    stage,
    motivationWake,
    checkIn: {
      completedMinimumAction: dailySnapshot.completedMinimumAction,
      lowEfficiency: dailySnapshot.lowEfficiency,
      reason: checkIn.reason,
      effectiveSessionCount,
      reviewSubmitted: dailySnapshot.reviewSubmitted,
    },
    recovery,
    subjects: subjects.map(serializeSubject),
    tasks: taskDtos,
    debtTasks: debtTaskDtos,
    debtReorder,
    visibleRecoveryTasks,
    activeSession: activeSession ? serializeSession(activeSession) : null,
    latestCompletedSession,
    review: review ? serializeReview(review) : null,
    syllabusOverview: subjects.map((subject) => serializeSyllabusOverview(subject)),
    signals: {
      antiFake: lowConversionCount > 0
        ? `存在 ${lowConversionCount} 段低转化学习，今天还需要补一个可检查产出`
        : "结束计时后会检查本次学习是否留下产出",
      lowConversionCount,
      review: dailySnapshot.reviewSubmitted ? "今日复盘已提交" : "还未提交今日复盘",
      ai: "AI disabled 时使用本地规则建议；真实外部 AI 调用仍需单独确认隐私边界",
    },
  };
}

export async function getTaskDebtReorderSuggestion(now = new Date()): Promise<TaskDebtReorderDto> {
  const dashboard = await getTodayDashboard(now);
  return dashboard.debtReorder;
}

export async function createStudyTask(input: CreateTaskInput, actorId: string): Promise<StudyTaskDto> {
  await assertSubjectExists(input.subjectId);
  if (input.syllabusNodeId) {
    await assertSyllabusNodeBelongsToSubject(input.syllabusNodeId, input.subjectId);
  }

  const day = input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start;
  const task = await prisma.$transaction(async (tx) => {
    const createdTask = await tx.studyTask.create({
      data: {
        subjectId: input.subjectId,
        syllabusNodeId: input.syllabusNodeId ?? null,
        title: input.title,
        type: input.type,
        priority: toDbPriority(input.priority),
        plannedDate: day,
        estimatedMinutes: input.estimatedMinutes,
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    await audit(actorId, "STUDY_TASK_CREATED", "StudyTask", createdTask.id, tx);
    await refreshCheckInSnapshotsForDates([createdTask.plannedDate], tx);

    return createdTask;
  });

  return serializeTask(task);
}

export async function listStudyTasks(): Promise<StudyTaskDto[]> {
  const tasks = await prisma.studyTask.findMany({
    include: {
      subject: true,
      syllabusNode: true,
    },
    orderBy: [{ plannedDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  return tasks.map(serializeTask);
}

export async function updateStudyTask(id: string, input: UpdateTaskInput, actorId: string): Promise<StudyTaskDto> {
  const existing = await prisma.studyTask.findUnique({
    where: { id },
    select: {
      subjectId: true,
      syllabusNodeId: true,
      plannedDate: true,
    },
  });

  if (!existing) {
    throw new ApiError("TASK_NOT_FOUND", 404);
  }

  if (input.subjectId) {
    await assertSubjectExists(input.subjectId);
  }

  const resolvedSubjectId = input.subjectId ?? existing.subjectId;
  const resolvedSyllabusNodeId = input.syllabusNodeId === undefined ? existing.syllabusNodeId : input.syllabusNodeId;
  if (resolvedSyllabusNodeId) {
    await assertSyllabusNodeBelongsToSubject(resolvedSyllabusNodeId, resolvedSubjectId);
  }

  const task = await prisma.$transaction(async (tx) => {
    const updatedTask = await tx.studyTask.update({
      where: { id },
      data: {
        subjectId: input.subjectId,
        syllabusNodeId: input.syllabusNodeId,
        title: input.title,
        type: input.type,
        priority: input.priority ? toDbPriority(input.priority) : undefined,
        plannedDate: input.plannedDate ? new Date(input.plannedDate) : undefined,
        estimatedMinutes: input.estimatedMinutes,
        reviewText: input.reviewText,
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    await audit(actorId, "STUDY_TASK_UPDATED", "StudyTask", updatedTask.id, tx);
    if (input.plannedDate) {
      await refreshCheckInSnapshotsForDates([existing.plannedDate, updatedTask.plannedDate], tx);
    }

    return updatedTask;
  });

  return serializeTask(task);
}

export async function completeStudyTask(id: string, reviewText: string | undefined, actorId: string): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await tx.studyTask.findUnique({
      where: { id },
      select: {
        status: true,
        debtStatus: true,
        plannedDate: true,
        type: true,
      },
    });
    if (!existing) {
      throw new ApiError("TASK_NOT_FOUND", 404);
    }

    const completedAt = new Date();
    const updatedTask = await tx.studyTask.update({
      where: { id },
      data: {
        status: "DONE",
        debtStatus: "NONE",
        reviewText,
        completedAt,
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    await audit(actorId, "STUDY_TASK_COMPLETED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "complete",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: normalizeTaskDebtReason(reviewText, "手动完成任务"),
      metadata: {
        source: "task_complete_api",
        plannedDate: existing.plannedDate.toISOString(),
        completedAt: completedAt.toISOString(),
        reviewTextProvided: Boolean(reviewText?.trim()),
        taskType: existing.type,
        actualMinutes: updatedTask.actualMinutes,
      },
    }, tx);
    await refreshCheckInSnapshotsForDates([updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function deferStudyTask(id: string, plannedDate: string | undefined, reviewText: string | undefined, actorId: string): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await tx.studyTask.findUnique({
      where: { id },
      select: {
        status: true,
        debtStatus: true,
        plannedDate: true,
        type: true,
      },
    });
    if (!existing) {
      throw new ApiError("TASK_NOT_FOUND", 404);
    }

    const targetPlannedDate = plannedDate ? new Date(plannedDate) : getNextStudyDayStart();
    const updatedTask = await tx.studyTask.update({
      where: { id },
      data: {
        status: "DEFERRED",
        debtStatus: "ACCEPTABLE",
        plannedDate: targetPlannedDate,
        reviewText,
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    await audit(actorId, "STUDY_TASK_DEFERRED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "defer",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: normalizeTaskDebtReason(reviewText, "延期到下一学习日"),
      metadata: {
        source: "task_defer_api",
        fromPlannedDate: existing.plannedDate.toISOString(),
        toPlannedDate: targetPlannedDate.toISOString(),
        requestedPlannedDate: plannedDate ?? null,
        defaultedToNextStudyDay: plannedDate === undefined,
        taskType: existing.type,
      },
    }, tx);
    await refreshCheckInSnapshotsForDates([existing.plannedDate, updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function dropStudyTask(id: string, actorId: string): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await tx.studyTask.findUnique({
      where: { id },
      select: {
        status: true,
        debtStatus: true,
        plannedDate: true,
        type: true,
        completedAt: true,
      },
    });
    if (!existing) {
      throw new ApiError("TASK_NOT_FOUND", 404);
    }

    const updatedTask = await tx.studyTask.update({
      where: { id },
      data: {
        status: "SKIPPED",
        debtStatus: "NONE",
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    await audit(actorId, "STUDY_TASK_DROPPED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "drop",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: "放弃当前任务",
      metadata: {
        source: "task_drop_api",
        plannedDate: existing.plannedDate.toISOString(),
        taskType: existing.type,
        previousCompletedAt: existing.completedAt?.toISOString() ?? null,
      },
    }, tx);
    await refreshCheckInSnapshotsForDates([updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function recoverStudyTask(id: string, input: RecoverTaskInput, actorId: string): Promise<StudyTaskDto> {
  const existing = await getTaskForLightweightDebtAction(id);
  const targetPlannedDate = input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start;
  const task = await prisma.$transaction(async (tx) => {
    const updatedTask = await tx.studyTask.update({
      where: { id },
      data: {
        status: "TODO",
        debtStatus: "ACCEPTABLE",
        plannedDate: targetPlannedDate,
        reviewText: mergeTaskReviewText(existing.reviewText, input.reviewText, "补做：拉回今天作为恢复任务"),
        completedAt: null,
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    await audit(actorId, "STUDY_TASK_RECOVERED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "recover",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: normalizeTaskDebtReason(input.reviewText, "补做：拉回今天作为恢复任务"),
      metadata: {
        source: "task_recover_api",
        fromPlannedDate: existing.plannedDate.toISOString(),
        toPlannedDate: targetPlannedDate.toISOString(),
        requestedPlannedDate: input.plannedDate ?? null,
        previousCompletedAt: existing.completedAt?.toISOString() ?? null,
        taskType: existing.type,
      },
    }, tx);
    await refreshCheckInSnapshotsForDates([existing.plannedDate, updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function splitStudyTask(id: string, input: SplitTaskInput, actorId: string): Promise<{
  originalTask: StudyTaskDto;
  task: StudyTaskDto;
}> {
  const existing = await getTaskForLightweightDebtAction(id);
  const plannedDate = input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start;

  const [originalTask, task] = await prisma.$transaction(async (tx) => {
    const createdTask = await tx.studyTask.create({
      data: {
        subjectId: existing.subjectId,
        syllabusNodeId: existing.syllabusNodeId,
        parentTaskId: existing.id,
        title: input.title,
        type: existing.type === "simulation_exam" ? "review" : existing.type,
        status: "TODO",
        priority: existing.priority,
        debtStatus: "ACCEPTABLE",
        plannedDate,
        estimatedMinutes: input.estimatedMinutes,
        reviewText: mergeTaskReviewText(null, input.reviewText, `由任务「${existing.title}」拆小而来`),
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    const updatedOriginal = await tx.studyTask.update({
      where: { id },
      data: {
        status: existing.status === "DONE" || existing.status === "SKIPPED" ? existing.status : "DEFERRED",
        debtStatus: existing.status === "DONE" || existing.status === "SKIPPED" ? existing.debtStatus : "ACCEPTABLE",
        reviewText: mergeTaskReviewText(existing.reviewText, input.reviewText, `拆小：生成「${input.title}」作为最小推进任务`),
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    await audit(actorId, "STUDY_TASK_SPLIT_LIGHTWEIGHT", "StudyTask", createdTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedOriginal.id,
      actorId,
      action: "split",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedOriginal),
      relatedTaskId: createdTask.id,
      reason: normalizeTaskDebtReason(input.reviewText, `拆小：生成「${input.title}」作为最小推进任务`),
      metadata: {
        source: "task_split_api",
        childTaskId: createdTask.id,
        childTitle: createdTask.title,
        childPlannedDate: createdTask.plannedDate.toISOString(),
        childEstimatedMinutes: createdTask.estimatedMinutes,
        childType: createdTask.type,
        parentTaskId: existing.id,
        originalEstimatedMinutes: existing.estimatedMinutes,
        originalStatusWasTerminal: existing.status === "DONE" || existing.status === "SKIPPED",
      },
    }, tx);
    await refreshCheckInSnapshotsForDates([existing.plannedDate, createdTask.plannedDate], tx);

    return [updatedOriginal, createdTask];
  });

  return {
    originalTask: serializeTask(originalTask),
    task: serializeTask(task),
  };
}

export async function convertStudyTaskToReview(
  id: string,
  input: ConvertTaskToReviewInput,
  actorId: string,
): Promise<StudyTaskDto> {
  const existing = await getTaskForLightweightDebtAction(id);
  const task = await prisma.$transaction(async (tx) => {
    const updatedTask = await tx.studyTask.update({
      where: { id },
      data: {
        type: "review",
        status: "TODO",
        debtStatus: "ACCEPTABLE",
        plannedDate: input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start,
        estimatedMinutes: input.estimatedMinutes ?? Math.min(90, Math.max(25, existing.estimatedMinutes)),
        reviewText: mergeTaskReviewText(existing.reviewText, input.reviewText, "改成复习任务：先复盘产出，再决定是否继续原任务"),
        completedAt: null,
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    await audit(actorId, "STUDY_TASK_CONVERTED_TO_REVIEW", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "convert_review",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: normalizeTaskDebtReason(input.reviewText, "改成复习任务：先复盘产出，再决定是否继续原任务"),
      metadata: {
        source: "task_convert_review_api",
        fromType: existing.type,
        toType: "review",
        fromPlannedDate: existing.plannedDate.toISOString(),
        toPlannedDate: updatedTask.plannedDate.toISOString(),
        fromEstimatedMinutes: existing.estimatedMinutes,
        toEstimatedMinutes: updatedTask.estimatedMinutes,
        previousCompletedAt: existing.completedAt?.toISOString() ?? null,
      },
    }, tx);
    await refreshCheckInSnapshotsForDates([existing.plannedDate, updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function getActiveStudySession(): Promise<StudySessionDto | null> {
  const session = await prisma.studySession.findFirst({
    where: {
      status: {
        in: ["RUNNING", "PAUSED"],
      },
    },
    include: {
      subject: true,
      task: true,
      syllabusNode: true,
    },
    orderBy: { startedAt: "desc" },
  });

  return session ? serializeSession(session) : null;
}

export async function startStudySession(input: { subjectId?: string; taskId?: string; syllabusNodeId?: string | null }, actorId: string): Promise<StudySessionDto> {
  const active = await getActiveStudySession();
  if (active) {
    throw new ApiError("ACTIVE_SESSION_EXISTS", 409);
  }

  const task = input.taskId
    ? await prisma.studyTask.findUnique({
        where: { id: input.taskId },
      })
    : null;

  const subjectId = task?.subjectId ?? input.subjectId;
  if (!subjectId) {
    throw new ApiError("SUBJECT_REQUIRED", 400);
  }

  await assertSubjectExists(subjectId);
  const syllabusNodeId = input.syllabusNodeId ?? task?.syllabusNodeId ?? null;
  if (syllabusNodeId) {
    await assertSyllabusNodeBelongsToSubject(syllabusNodeId, subjectId);
  }

  const session = await prisma.$transaction(async (tx) => {
    const createdSession = await tx.studySession.create({
      data: {
        subjectId,
        taskId: task?.id,
        syllabusNodeId,
        status: "RUNNING",
        startedAt: new Date(),
      },
      include: {
        subject: true,
        task: true,
        syllabusNode: true,
      },
    });

    if (task && task.status === "TODO") {
      await tx.studyTask.update({
        where: { id: task.id },
        data: { status: "IN_PROGRESS" },
      });
      await refreshCheckInSnapshotsForDates([task.plannedDate], tx);
    }

    await audit(actorId, "STUDY_SESSION_STARTED", "StudySession", createdSession.id, tx);

    return createdSession;
  });

  return serializeSession(session);
}

export async function pauseStudySession(id: string, actorId: string): Promise<StudySessionDto> {
  const session = await prisma.studySession.update({
    where: { id, status: "RUNNING" },
    data: {
      status: "PAUSED",
      pausedAt: new Date(),
    },
    include: {
      subject: true,
      task: true,
      syllabusNode: true,
    },
  });

  await audit(actorId, "STUDY_SESSION_PAUSED", "StudySession", session.id);
  return serializeSession(session);
}

export async function resumeStudySession(id: string, actorId: string): Promise<StudySessionDto> {
  const existing = await prisma.studySession.findUnique({
    where: { id },
  });

  if (!existing || existing.status !== "PAUSED" || !existing.pausedAt) {
    throw new ApiError("SESSION_NOT_PAUSED", 409);
  }

  const now = new Date();
  const extraPauseSeconds = Math.max(0, Math.floor((now.getTime() - existing.pausedAt.getTime()) / 1000));
  const session = await prisma.studySession.update({
    where: { id },
    data: {
      status: "RUNNING",
      pausedAt: null,
      accumulatedPauseSeconds: existing.accumulatedPauseSeconds + extraPauseSeconds,
    },
    include: {
      subject: true,
      task: true,
      syllabusNode: true,
    },
  });

  await audit(actorId, "STUDY_SESSION_RESUMED", "StudySession", session.id);
  return serializeSession(session);
}

export async function endStudySession(id: string, input: EndSessionInput, actorId: string): Promise<StudySessionDto> {
  const existing = await prisma.studySession.findUnique({
    where: { id },
  });

  if (!existing || (existing.status !== "RUNNING" && existing.status !== "PAUSED")) {
    throw new ApiError("SESSION_NOT_ACTIVE", 409);
  }

  const now = new Date();
  const pauseSeconds =
    existing.status === "PAUSED" && existing.pausedAt
      ? existing.accumulatedPauseSeconds + Math.max(0, Math.floor((now.getTime() - existing.pausedAt.getTime()) / 1000))
      : existing.accumulatedPauseSeconds;
  const effectiveSeconds = getTimerElapsedSeconds({
    status: "completed",
    startedAt: existing.startedAt,
    endedAt: now,
    accumulatedPauseSeconds: pauseSeconds,
  });
  const effectiveMinutes = Math.max(0, Math.floor(effectiveSeconds / 60));
  const closeout = normalizeStudyCloseout({
    minutes: effectiveMinutes,
    userMarkedEffective: input.isEffective,
    understandingLevel: input.understandingLevel,
    minimalOutput: input.minimalOutput,
    nextAction: input.nextAction,
    producedNote: input.producedNote,
    producedMistake: input.producedMistake,
    note: input.note,
  });
  const isEffective = closeout.isEffective;
  const note = closeout.closeoutText;

  const session = await prisma.$transaction(async (tx) => {
    const updatedSession = await tx.studySession.update({
      where: { id },
      data: {
        status: "COMPLETED",
        endedAt: now,
        pausedAt: null,
        accumulatedPauseSeconds: pauseSeconds,
        effectiveMinutes,
        qualityScore: input.qualityScore,
        isEffective,
        understandingLevel: input.understandingLevel,
        minimalOutput: input.minimalOutput,
        nextAction: input.nextAction,
        producedNote: input.producedNote,
        producedMistake: input.producedMistake,
        isLowConversion: closeout.isLowConversion,
        antiFakeReason: closeout.antiFakeReason,
        requiredOutput: closeout.requiredOutput,
        closeoutVersion: 1,
        note,
      },
      include: {
        subject: true,
        task: true,
        syllabusNode: true,
      },
    });

    const linkedTask = existing.taskId
      ? await tx.studyTask.findUnique({
          where: { id: existing.taskId },
          select: {
            id: true,
            status: true,
            debtStatus: true,
            plannedDate: true,
            type: true,
          },
        })
      : null;

    if (linkedTask) {
      const updatedTask = await tx.studyTask.update({
        where: { id: linkedTask.id },
        data: {
          actualMinutes: {
            increment: effectiveMinutes,
          },
          status: input.completeTask && isEffective ? "DONE" : "IN_PROGRESS",
          debtStatus: input.completeTask && isEffective ? "NONE" : undefined,
          completedAt: input.completeTask && isEffective ? now : undefined,
        },
      });
      if (input.completeTask && isEffective) {
        await createTaskDebtEvent({
          taskId: updatedTask.id,
          actorId,
          action: "complete",
          from: toTaskDebtEventState(linkedTask),
          to: toTaskDebtEventState(updatedTask),
          reason: "计时结束时勾选完成且本次有效",
          metadata: {
            source: "study_session_end",
            studySessionId: updatedSession.id,
            effectiveMinutes,
            qualityScore: input.qualityScore,
            startedAt: existing.startedAt.toISOString(),
            endedAt: now.toISOString(),
            isLowConversion: closeout.isLowConversion,
            producedNote: input.producedNote,
            producedMistake: input.producedMistake,
            taskType: linkedTask.type,
          },
        }, tx);
      }
    }

    if (existing.syllabusNodeId && effectiveMinutes > 0) {
      await tx.syllabusNode.update({
        where: { id: existing.syllabusNodeId },
        data: {
          actualMinutes: {
            increment: effectiveMinutes,
          },
        },
      });
    }

    await audit(actorId, "STUDY_SESSION_ENDED", "StudySession", updatedSession.id, tx);
    await refreshCheckInSnapshotsForDates([existing.startedAt, linkedTask?.plannedDate ?? null], tx);

    return updatedSession;
  });

  return serializeSession(session);
}

export async function getTodayReview(): Promise<DailyReviewDto | null> {
  const day = getStudyDayRange();
  const review = await prisma.dailyReview.findUnique({
    where: { reviewDate: day.start },
  });

  return review ? serializeReview(review) : null;
}

export async function saveTodayReview(input: SaveReviewInput, actorId: string): Promise<DailyReviewDto> {
  const day = getStudyDayRange();
  const review = await prisma.$transaction(async (tx) => {
    const metrics = await getTodaySessionMetrics(day.start, day.end, tx);
    const savedReview = await tx.dailyReview.upsert({
      where: { reviewDate: day.start },
      create: {
        reviewDate: day.start,
        totalMinutes: metrics.totalMinutes,
        effectiveMinutes: metrics.effectiveMinutes,
        summary: input.summary,
        lostControl: input.lostControl,
        keepAction: input.keepAction,
        tomorrowMinimum: input.tomorrowMinimum,
        mood: input.mood,
      },
      update: {
        totalMinutes: metrics.totalMinutes,
        effectiveMinutes: metrics.effectiveMinutes,
        summary: input.summary,
        lostControl: input.lostControl,
        keepAction: input.keepAction,
        tomorrowMinimum: input.tomorrowMinimum,
        mood: input.mood,
      },
    });

    await audit(actorId, "DAILY_REVIEW_SAVED", "DailyReview", savedReview.id, tx);
    await refreshCheckInSnapshotsForDates([day.start], tx);

    return savedReview;
  });

  return serializeReview(review);
}

export async function getMotivationVault(): Promise<MotivationVaultDto | null> {
  const vault = await prisma.motivationVault.findFirst({
    orderBy: { createdAt: "asc" },
  });

  return vault ? serializeMotivationVault(vault) : null;
}

export async function saveMotivationVault(
  input: SaveMotivationVaultInput,
  actorId: string,
): Promise<MotivationVaultDto> {
  const existing = await prisma.motivationVault.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const data = {
    whyStarted: normalizeOptionalText(input.whyStarted),
    neverReturnTo: normalizeOptionalText(input.neverReturnTo),
    futureSelf: normalizeOptionalText(input.futureSelf),
    messageToFuture: normalizeOptionalText(input.messageToFuture),
    firstSimulationDiary: normalizeOptionalText(input.firstSimulationDiary),
  };

  const vault = existing
    ? await prisma.motivationVault.update({
        where: { id: existing.id },
        data,
      })
    : await prisma.motivationVault.create({
        data,
      });

  await audit(actorId, "MOTIVATION_VAULT_SAVED", "MotivationVault", vault.id);
  return serializeMotivationVault(vault);
}

export async function listSubjects(): Promise<SubjectDto[]> {
  const subjects = await prisma.subject.findMany({
    orderBy: { sortOrder: "asc" },
  });

  return subjects.map(serializeSubject);
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

async function getTaskForLightweightDebtAction(id: string) {
  const task = await prisma.studyTask.findUnique({
    where: { id },
    include: {
      subject: true,
      syllabusNode: true,
    },
  });

  if (!task) {
    throw new ApiError("TASK_NOT_FOUND", 404);
  }

  return task;
}

async function getTodaySessionMetrics(
  start: Date,
  end: Date,
  client: StudyDbClient = prisma,
): Promise<{ totalMinutes: number; effectiveMinutes: number }> {
  const sessions = await client.studySession.findMany({
    where: {
      startedAt: {
        gte: start,
        lt: end,
      },
      status: "COMPLETED",
    },
    select: {
      effectiveMinutes: true,
      isEffective: true,
    },
  });

  return {
    totalMinutes: sessions.reduce((total, session) => total + session.effectiveMinutes, 0),
    effectiveMinutes: sessions
      .filter((session) => session.isEffective)
      .reduce((total, session) => total + session.effectiveMinutes, 0),
  };
}

function serializeSubject(subject: {
  id: string;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
}): SubjectDto {
  return {
    id: subject.id,
    code: subject.code,
    name: subject.name,
    color: subject.color,
    sortOrder: subject.sortOrder,
  };
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

function createTaskDebtReorder(input: {
  tasks: StudyTaskDto[];
  dayStart: Date;
  pressure: TaskDebtReorderPressure;
  availableMinutes: number;
}): TaskDebtReorderDto {
  const plan = suggestTaskDebtReorder({
    pressure: input.pressure,
    availableMinutes: input.availableMinutes,
    tasks: input.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      subject: task.subjectName,
      priority: task.priority,
      estimatedMinutes: task.estimatedMinutes,
      daysOverdue: getDaysOverdue(task.plannedDate, input.dayStart),
      hasRecentEvidence: task.actualMinutes > 0,
      blocksStageGoal: task.priority === "critical" || task.priority === "high",
      isReviewable: task.type === "review" || task.actualMinutes > 0 || Boolean(task.syllabusNodeId),
    })),
  });
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));

  return {
    pressure: input.pressure,
    availableMinutes: input.availableMinutes,
    summary: plan.summary,
    canAutoApply: plan.canAutoApply,
    requiresUserConfirmation: plan.requiresUserConfirmation,
    suggestions: plan.suggestions.flatMap((suggestion) => {
      const task = taskById.get(suggestion.taskId);
      if (!task) return [];

      return [{
        taskId: suggestion.taskId,
        taskTitle: task.title,
        subjectName: task.subjectName,
        action: suggestion.action,
        reason: suggestion.reason,
        estimatedMinutes: suggestion.estimatedMinutes,
        rank: suggestion.rank,
      }];
    }),
  };
}

function determineDebtReorderPressure(
  riskState: RiskState,
  stagePressure: "low" | "medium" | "high" | "sprint",
  recoveryActive: boolean,
): TaskDebtReorderPressure {
  if (stagePressure === "sprint" || riskState === "sprint") return "sprint";
  if (recoveryActive || riskState === "danger" || riskState === "lost") return "recovery";
  if (stagePressure === "high") return "stage_impact";
  return "normal";
}

function determineDebtReorderAvailableMinutes(
  stagePressure: "low" | "medium" | "high" | "sprint",
  recoveryActive: boolean,
  recoveryMinimumMinutes: number,
): number {
  if (recoveryActive) return recoveryMinimumMinutes;
  if (stagePressure === "sprint") return 240;
  if (stagePressure === "high") return 180;
  return 120;
}

function getDaysOverdue(plannedDate: string, dayStart: Date): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((dayStart.getTime() - new Date(plannedDate).getTime()) / dayMs));
}

function serializeSession(session: {
  id: string;
  subjectId: string;
  taskId: string | null;
  syllabusNodeId: string | null;
  status: DbStudySessionStatus;
  startedAt: Date;
  pausedAt: Date | null;
  endedAt: Date | null;
  accumulatedPauseSeconds: number;
  effectiveMinutes: number;
  qualityScore: number | null;
  isEffective: boolean | null;
  understandingLevel: string | null;
  minimalOutput: string | null;
  nextAction: string | null;
  producedNote: boolean;
  producedMistake: boolean;
  isLowConversion: boolean | null;
  antiFakeReason: string | null;
  requiredOutput: string | null;
  closeoutVersion: number;
  note: string | null;
  subject: {
    name: string;
  };
  task?: {
    title: string;
  } | null;
  syllabusNode?: {
    title: string;
  } | null;
}): StudySessionDto {
  return {
    id: session.id,
    subjectId: session.subjectId,
    subjectName: session.subject.name,
    taskId: session.taskId,
    taskTitle: session.task?.title ?? null,
    syllabusNodeId: session.syllabusNodeId,
    syllabusNodeTitle: session.syllabusNode?.title ?? null,
    status: fromDbSessionStatus(session.status),
    startedAt: session.startedAt.toISOString(),
    pausedAt: session.pausedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    accumulatedPauseSeconds: session.accumulatedPauseSeconds,
    effectiveMinutes: session.effectiveMinutes,
    qualityScore: session.qualityScore,
    isEffective: session.isEffective,
    understandingLevel: session.understandingLevel,
    minimalOutput: session.minimalOutput,
    nextAction: session.nextAction,
    producedNote: session.producedNote,
    producedMistake: session.producedMistake,
    isLowConversion: session.isLowConversion,
    antiFakeReason: session.antiFakeReason,
    requiredOutput: session.requiredOutput,
    closeoutVersion: session.closeoutVersion,
    note: session.note,
  };
}

function toCheckInSnapshotSession(session: StudySessionDto) {
  return {
    effectiveMinutes: session.effectiveMinutes,
    isEffective: session.isEffective,
    isLowConversion: session.isLowConversion,
  };
}

function getLatestCompletedSession(sessions: StudySessionDto[]): StudySessionDto | null {
  return sessions.reduce<StudySessionDto | null>((latest, session) => {
    if (session.status !== "completed") return latest;
    if (!latest) return session;
    return getSessionEndTime(session) > getSessionEndTime(latest) ? session : latest;
  }, null);
}

function getSessionEndTime(session: StudySessionDto): number {
  return Date.parse(session.endedAt ?? session.startedAt);
}

function serializeReview(review: {
  id: string;
  reviewDate: Date;
  totalMinutes: number;
  effectiveMinutes: number;
  summary: string | null;
  lostControl: string | null;
  keepAction: string | null;
  tomorrowMinimum: string | null;
  mood: string | null;
  aiSuggestion: string | null;
}): DailyReviewDto {
  return {
    id: review.id,
    reviewDate: review.reviewDate.toISOString(),
    totalMinutes: review.totalMinutes,
    effectiveMinutes: review.effectiveMinutes,
    summary: review.summary,
    lostControl: review.lostControl,
    keepAction: review.keepAction,
    tomorrowMinimum: review.tomorrowMinimum,
    mood: review.mood,
    aiSuggestion: review.aiSuggestion,
  };
}

function serializeMotivationVault(vault: {
  id: string;
  whyStarted: string | null;
  neverReturnTo: string | null;
  futureSelf: string | null;
  messageToFuture: string | null;
  firstSimulationDiary: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MotivationVaultDto {
  return {
    id: vault.id,
    whyStarted: vault.whyStarted,
    neverReturnTo: vault.neverReturnTo,
    futureSelf: vault.futureSelf,
    messageToFuture: vault.messageToFuture,
    firstSimulationDiary: vault.firstSimulationDiary,
    createdAt: vault.createdAt.toISOString(),
    updatedAt: vault.updatedAt.toISOString(),
  };
}

function serializeSyllabusOverview(subject: {
  name: string;
  color: string;
  syllabusNodes: Array<{
    status: string;
  }>;
}): SyllabusOverviewDto {
  const total = subject.syllabusNodes.length;
  const covered = subject.syllabusNodes.filter((node) => node.status === "COVERED" || node.status === "MASTERED").length;

  return {
    label: subject.name,
    progress: total === 0 ? 0 : Math.round((covered / total) * 100),
    color: subject.color,
  };
}

function getOverallSyllabusProgress(subjects: Array<{
  syllabusNodes: Array<{
    status: string;
  }>;
}>): number {
  const nodes = subjects.flatMap((subject) => subject.syllabusNodes);
  if (nodes.length === 0) return 0;

  const covered = nodes.filter((node) => node.status === "COVERED" || node.status === "MASTERED").length;
  return covered / nodes.length;
}

function toCoreTask(task: StudyTaskDto): StudyTaskInput {
  return {
    id: task.id,
    title: task.title,
    subject: task.subjectName,
    type: task.type,
    status: task.status,
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
    priority: task.priority,
  };
}

function getRecoveryTaskCandidates(todayTasks: StudyTaskDto[], debtTasks: StudyTaskDto[]): StudyTaskDto[] {
  const byId = new Map([...debtTasks, ...todayTasks].map((task) => [task.id, task]));
  return rankRecoveryTaskCandidates({
    todayTasks: todayTasks.map(toRecoveryTaskCandidate),
    debtTasks: debtTasks.map(toRecoveryTaskCandidate),
  })
    .map((candidate) => byId.get(candidate.id))
    .filter((task): task is StudyTaskDto => Boolean(task));
}

function toRecoveryTaskCandidate(task: StudyTaskDto) {
  return {
    id: task.id,
    title: task.title,
    subject: task.subjectName,
    status: task.status,
    priority: task.priority,
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
  };
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function isMajorReview(review: { summary: string | null; lostControl: string | null } | null): boolean {
  if (!review) return false;

  const text = `${review.summary ?? ""}\n${review.lostControl ?? ""}`.trim();
  if (text.length < 24) return false;

  return /重大|失控|崩|断签|放弃|危险|拖延|熬夜|崩盘/.test(text);
}

function sumTodayMinutes(sessions: StudySessionDto[], activeSession: StudySessionDto | null, now: Date): number {
  const completedMinutes = sessions.reduce((total, session) => total + session.effectiveMinutes, 0);
  if (!activeSession || activeSession.status === "completed" || activeSession.status === "canceled") {
    return completedMinutes;
  }

  const activeSeconds = getTimerElapsedSeconds({
    status: activeSession.status === "running" ? "running" : "paused",
    startedAt: new Date(activeSession.startedAt),
    pausedAt: activeSession.pausedAt ? new Date(activeSession.pausedAt) : undefined,
    accumulatedPauseSeconds: activeSession.accumulatedPauseSeconds,
    now,
  });

  return completedMinutes + Math.floor(activeSeconds / 60);
}

function sumEffectiveMinutesByStudyDay(
  start: Date,
  days: number,
  sessions: Array<{
    startedAt: Date;
    effectiveMinutes: number;
  }>,
  checkInSnapshots: Map<string, { effectiveMinutes: number }>,
): number {
  let total = 0;

  for (let index = 0; index < days; index += 1) {
    const day = getStudyDayRange(new Date(start.getTime() + index * 24 * 60 * 60 * 1000));
    const snapshot = checkInSnapshots.get(day.key);
    total += snapshot
      ? snapshot.effectiveMinutes
      : sessions
          .filter((session) => session.startedAt >= day.start && session.startedAt < day.end)
          .reduce((sum, session) => sum + session.effectiveMinutes, 0);
  }

  return total;
}

function getEffectiveStudyStreak(
  sessions: Array<{
    startedAt: Date;
  }>,
  checkInSnapshots: Map<string, { effectiveMinutes: number }>,
  now: Date,
): number {
  const studiedDays = new Set(sessions.map((session) => getStudyDayKey(session.startedAt)));
  let cursor = getStudyDayRange(now).start;
  let streak = 0;

  for (let index = 0; index < 60; index += 1) {
    const key = getStudyDayKey(cursor);
    const snapshot = checkInSnapshots.get(key);
    const studied = snapshot ? snapshot.effectiveMinutes > 0 : studiedDays.has(key);
    if (!studied) {
      return streak;
    }

    streak += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  return streak;
}

function toDbPriority(priority: "low" | "medium" | "high" | "critical"): DbTaskPriority {
  return priority.toUpperCase() as DbTaskPriority;
}

function fromDbPriority(priority: DbTaskPriority): "low" | "medium" | "high" | "critical" {
  return priority.toLowerCase() as "low" | "medium" | "high" | "critical";
}

function fromDbTaskStatus(status: DbTaskStatus): "todo" | "in_progress" | "done" | "skipped" | "deferred" {
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

function fromDbSessionStatus(status: DbStudySessionStatus): "running" | "paused" | "completed" | "canceled" {
  return status.toLowerCase() as "running" | "paused" | "completed" | "canceled";
}

function mergeTaskReviewText(existing: string | null, note: string | undefined, fallback: string): string {
  const addition = note?.trim() || fallback;
  const merged = existing?.trim() ? `${existing.trim()}\n${addition}` : addition;
  return merged.slice(0, 2000);
}

function normalizeTaskDebtReason(note: string | undefined, fallback: string): string {
  const normalized = note?.trim() ?? "";
  return normalized.length > 0 ? normalized.slice(0, 1000) : fallback;
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
  client: StudyDbClient = prisma,
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
