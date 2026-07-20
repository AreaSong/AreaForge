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
  type RecoveryPlan,
  type RiskState,
  type StudyTaskInput,
  type TaskDebtReorderPressure,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { cache } from "react";
import { ApiError } from "@/lib/api/responses";
import { daysUntil, getNextStudyDayStart, getStudyDayKey, getStudyDayRange } from "./date";
import {
  listCheckInSnapshotsInRange,
  refreshCheckInSnapshotsForDates,
} from "./check-in-service";
import {
  applySessionCas,
  applyTaskCas,
  isUniqueConstraintViolation,
  type TaskCasPreimage,
} from "./concurrency";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import { createTaskDebtEvent } from "./task-debt-event-service";
import { fromDbPriority, fromDbTaskStatus, serializeTask, toDbPriority } from "./task-serializer";
import type {
  DailyReviewDto,
  MotivationVaultDto,
  RecoveryStateDto,
  StudySessionDto,
  StudyTaskDto,
  SubjectDto,
  TaskDebtReorderDto,
  SyllabusOverviewDto,
  TodayDashboardDto,
} from "./types";

const finalExamDate = new Date("2027-12-20T08:30:00+08:00");
const simulationDate = new Date("2026-12-20T08:30:00+08:00");
const recoveryStateLockKey = 2026070703;

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type DbTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type DbStudySessionStatus = "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELED";
type StudyDbClient = PrismaClient | Prisma.TransactionClient;

type DbRecoveryStateStatus = "active" | "completed" | "canceled";
type DbRecoveryTriggerType = "rule" | "manual";
type RecoveryStateRecord = {
  id: string;
  status: string;
  triggerType: string;
  startedAt: Date;
  endedAt: Date | null;
  targetMinutes: number;
  visibleTaskLimit: number;
  reason: string;
  exitCondition: string | null;
  metadata: Prisma.JsonValue | null;
  actorId: string | null;
};

export interface GetTodayDashboardOptions {
  actorId?: string | null;
  recordRecoveryRule?: boolean;
}

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

export interface StartManualRecoveryStateInput {
  reason?: string;
  targetMinutes?: number;
  visibleTaskLimit?: number;
}

export interface FinishRecoveryStateInput {
  exitCondition?: string;
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

export async function getTodayDashboard(
  now = new Date(),
  options: GetTodayDashboardOptions = {},
): Promise<TodayDashboardDto> {
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
    overdueTasks,
    recentSessions,
    checkInSnapshots,
    motivationVault,
    activeRecoveryState,
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
    // 单次取 12 条逾期任务：前 5 条给欠账预览，全量给欠账重排，替代原先两条同条件查询。
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
    findActiveRecoveryState(),
  ]);

  const sessionDtos = todaySessions.map(serializeSession);
  const taskDtos = tasks.map(serializeTask);
  const debtReorderTaskDtos = overdueTasks.map(serializeTask);
  const debtTaskDtos = debtReorderTaskDtos.slice(0, 5);
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
  const topRecoveryTask = recoveryTaskCandidates[0] ?? null;
  const realtimeRecovery = createRecoveryPlan({
    riskState: snapshot.riskState,
    debtCount,
    missedDays,
    effectiveMinutes,
    topTask: topRecoveryTask ? toCoreTask(topRecoveryTask) : snapshot.topTasks[0],
  });
  const recoveryState = activeRecoveryState ?? (
    options.recordRecoveryRule && realtimeRecovery.active
      ? await createRuleRecoveryState({
        plan: realtimeRecovery,
        actorId: options.actorId ?? null,
        topTask: topRecoveryTask,
        riskState: snapshot.riskState,
        debtCount,
        missedDays,
        effectiveMinutes,
        studyDayKey: day.key,
      })
      : null
  );
  const recovery = recoveryState
    ? createDashboardRecoveryFromState(recoveryState, topRecoveryTask)
    : createDashboardRecoveryFromRealtimePlan(realtimeRecovery);
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
      ai: "首页仅展示本地规则 AI 建议；真实 provider 只由鉴权 AI API 显式触发",
    },
  };
}

/**
 * 同一次服务端渲染内的只读共享副本：AI 建议、长期风险等次级消费方复用同一份
 * 作战台数据，避免每个消费方重复触发整组 Prisma 查询。写路径（recordRecoveryRule）
 * 仍走 getTodayDashboard 原函数。
 */
export const getTodayDashboardShared = cache(async (): Promise<TodayDashboardDto> => getTodayDashboard());

export async function getTaskDebtReorderSuggestion(now = new Date()): Promise<TaskDebtReorderDto> {
  const dashboard = await getTodayDashboard(now);
  return dashboard.debtReorder;
}

export async function startManualRecoveryState(
  input: StartManualRecoveryStateInput,
  actorId: string,
): Promise<RecoveryStateDto> {
  const state = await prisma.$transaction(async (tx) => {
    await lockRecoveryState(tx);
    const activeState = await findActiveRecoveryState(tx);
    if (activeState) return activeState;

    return tx.recoveryState.create({
      data: {
        status: "active",
        triggerType: "manual",
        targetMinutes: normalizeRecoveryTargetMinutes(input.targetMinutes, 30),
        visibleTaskLimit: normalizeRecoveryVisibleTaskLimit(input.visibleTaskLimit, 1),
        reason: normalizeOptionalText(input.reason)
          ?? "手动进入恢复：今天先把任务面缩到最小，恢复有效学习连续性。",
        actorId,
        metadata: {
          source: "manual_recovery_api",
        },
      },
    });
  });

  return serializeRecoveryState(state);
}

export async function completeRecoveryState(
  id: string,
  input: FinishRecoveryStateInput,
): Promise<RecoveryStateDto> {
  return finishRecoveryState(id, "completed", input.exitCondition, "用户标记恢复完成");
}

export async function cancelRecoveryState(
  id: string,
  input: FinishRecoveryStateInput,
): Promise<RecoveryStateDto> {
  return finishRecoveryState(id, "canceled", input.exitCondition, "用户取消恢复状态");
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
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"]);

    const resolvedSubjectId = input.subjectId ?? existing.subjectId;
    const resolvedSyllabusNodeId = input.syllabusNodeId === undefined ? existing.syllabusNodeId : input.syllabusNodeId;
    await assertSubjectExists(resolvedSubjectId, tx);
    if (resolvedSyllabusNodeId) {
      await assertSyllabusNodeBelongsToSubject(resolvedSyllabusNodeId, resolvedSubjectId, tx);
    }

    await applyTaskCas(tx, existing, {
      subjectId: input.subjectId,
      syllabusNodeId: input.syllabusNodeId,
      title: input.title,
      type: input.type,
      priority: input.priority ? toDbPriority(input.priority) : undefined,
      plannedDate: input.plannedDate ? new Date(input.plannedDate) : undefined,
      estimatedMinutes: input.estimatedMinutes,
      reviewText: input.reviewText,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

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
    const existing = await getTaskCommandPreimage(tx, id);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"]);

    const completedAt = new Date();
    await applyTaskCas(tx, existing, {
      status: "DONE",
      debtStatus: "NONE",
      reviewText,
      completedAt,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

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
    const existing = await getTaskCommandPreimage(tx, id);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"], true);

    const targetPlannedDate = plannedDate ? new Date(plannedDate) : getNextStudyDayStart();
    await applyTaskCas(tx, existing, {
      status: "DEFERRED",
      debtStatus: "ACCEPTABLE",
      plannedDate: targetPlannedDate,
      reviewText,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

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
    const existing = await getTaskCommandPreimage(tx, id);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"], true);

    await applyTaskCas(tx, existing, {
      status: "SKIPPED",
      debtStatus: "NONE",
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

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
  const targetPlannedDate = input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start;
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED", "SKIPPED"]);
    await applyTaskCas(tx, existing, {
      status: "TODO",
      debtStatus: "ACCEPTABLE",
      plannedDate: targetPlannedDate,
      reviewText: mergeTaskReviewText(existing.reviewText, input.reviewText, "补做：拉回今天作为恢复任务"),
      completedAt: null,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

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
  const plannedDate = input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start;

  const [originalTask, task] = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"]);
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

    await applyTaskCas(tx, existing, {
      status: "DEFERRED",
      debtStatus: "ACCEPTABLE",
      reviewText: mergeTaskReviewText(existing.reviewText, input.reviewText, `拆小：生成「${input.title}」作为最小推进任务`),
    });
    const updatedOriginal = await getUpdatedTaskForResponse(tx, id);

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
        originalStatusWasTerminal: false,
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
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED", "SKIPPED"]);
    await applyTaskCas(tx, existing, {
      type: "review",
      status: "TODO",
      debtStatus: "ACCEPTABLE",
      plannedDate: input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start,
      estimatedMinutes: input.estimatedMinutes ?? Math.min(90, Math.max(25, existing.estimatedMinutes)),
      reviewText: mergeTaskReviewText(existing.reviewText, input.reviewText, "改成复习任务：先复盘产出，再决定是否继续原任务"),
      completedAt: null,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

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
  try {
    const session = await prisma.$transaction(async (tx) => {
      const task = input.taskId ? await getTaskCommandPreimage(tx, input.taskId) : null;
      if (task) {
        assertTaskSourceStatus(task, ["TODO", "IN_PROGRESS"]);
      }

      const subjectId = task?.subjectId ?? input.subjectId;
      if (!subjectId) {
        throw new ApiError("SUBJECT_REQUIRED", 400);
      }

      await assertSubjectExists(subjectId, tx);
      const syllabusNodeId = input.syllabusNodeId ?? task?.syllabusNodeId ?? null;
      if (syllabusNodeId) {
        await assertSyllabusNodeBelongsToSubject(syllabusNodeId, subjectId, tx);
      }

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

      if (task) {
        await applyTaskCas(tx, task, { status: "IN_PROGRESS" });
        await refreshCheckInSnapshotsForDates([task.plannedDate], tx);
      }

      await audit(actorId, "STUDY_SESSION_STARTED", "StudySession", createdSession.id, tx);
      return createdSession;
    });

    return serializeSession(session);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ApiError("ACTIVE_SESSION_EXISTS", 409);
    }
    throw error;
  }
}

export async function pauseStudySession(id: string, actorId: string): Promise<StudySessionDto> {
  const session = await prisma.$transaction(async (tx) => {
    const existing = await tx.studySession.findUnique({ where: { id } });
    if (!existing || existing.status !== "RUNNING") {
      throw new ApiError("SESSION_STATE_CONFLICT", 409);
    }

    await applySessionCas(tx, existing, {
      status: "PAUSED",
      pausedAt: new Date(),
    });
    await audit(actorId, "STUDY_SESSION_PAUSED", "StudySession", id, tx);

    return getUpdatedSessionForResponse(tx, id);
  });

  return serializeSession(session);
}

export async function resumeStudySession(id: string, actorId: string): Promise<StudySessionDto> {
  const session = await prisma.$transaction(async (tx) => {
    const existing = await tx.studySession.findUnique({ where: { id } });
    if (!existing || existing.status !== "PAUSED" || !existing.pausedAt) {
      throw new ApiError("SESSION_STATE_CONFLICT", 409);
    }

    const now = new Date();
    const extraPauseSeconds = Math.max(0, Math.floor((now.getTime() - existing.pausedAt.getTime()) / 1000));
    await applySessionCas(tx, existing, {
      status: "RUNNING",
      pausedAt: null,
      accumulatedPauseSeconds: existing.accumulatedPauseSeconds + extraPauseSeconds,
    });
    await audit(actorId, "STUDY_SESSION_RESUMED", "StudySession", id, tx);

    return getUpdatedSessionForResponse(tx, id);
  });

  return serializeSession(session);
}

export async function endStudySession(id: string, input: EndSessionInput, actorId: string): Promise<StudySessionDto> {
  const session = await prisma.$transaction(async (tx) => {
    const existing = await tx.studySession.findUnique({ where: { id } });
    if (!existing || (existing.status !== "RUNNING" && existing.status !== "PAUSED")) {
      throw new ApiError("SESSION_STATE_CONFLICT", 409);
    }

    const now = new Date();
    const pauseSeconds = existing.status === "PAUSED" && existing.pausedAt
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

    await applySessionCas(tx, existing, {
      status: "COMPLETED",
      endedAt: now,
      pausedAt: null,
      accumulatedPauseSeconds: pauseSeconds,
      effectiveMinutes,
      qualityScore: input.qualityScore,
      isEffective: closeout.isEffective,
      understandingLevel: input.understandingLevel,
      minimalOutput: input.minimalOutput,
      nextAction: input.nextAction,
      producedNote: input.producedNote,
      producedMistake: input.producedMistake,
      isLowConversion: closeout.isLowConversion,
      antiFakeReason: closeout.antiFakeReason,
      requiredOutput: closeout.requiredOutput,
      closeoutVersion: 1,
      note: closeout.closeoutText,
    });

    const linkedTask = existing.taskId
      ? await getTaskCommandPreimage(tx, existing.taskId)
      : null;

    if (linkedTask) {
      assertTaskSourceStatus(linkedTask, ["TODO", "IN_PROGRESS", "DEFERRED"]);
      const shouldCompleteTask = input.completeTask && closeout.isEffective;
      await applyTaskCas(tx, linkedTask, {
        actualMinutes: { increment: effectiveMinutes },
        status: shouldCompleteTask ? "DONE" : "IN_PROGRESS",
        debtStatus: shouldCompleteTask ? "NONE" : undefined,
        completedAt: shouldCompleteTask ? now : null,
      });
      const updatedTask = await tx.studyTask.findUnique({ where: { id: linkedTask.id } });
      if (!updatedTask) throw new ApiError("TASK_STATE_CONFLICT", 409);
      if (shouldCompleteTask) {
        await createTaskDebtEvent({
          taskId: updatedTask.id,
          actorId,
          action: "complete",
          from: toTaskDebtEventState(linkedTask),
          to: toTaskDebtEventState(updatedTask),
          reason: "计时结束时勾选完成且本次有效",
          metadata: {
            source: "study_session_end",
            studySessionId: existing.id,
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

    await audit(actorId, "STUDY_SESSION_ENDED", "StudySession", existing.id, tx);
    await refreshCheckInSnapshotsForDates([existing.startedAt, linkedTask?.plannedDate ?? null], tx);

    return getUpdatedSessionForResponse(tx, id);
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

// 同一次服务端渲染内共享动机封存读取（模拟工作台与阶段草稿共用）；写路径仍读原函数。
export const getMotivationVaultShared = cache(async (): Promise<MotivationVaultDto | null> => getMotivationVault());

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

async function assertSubjectExists(subjectId: string, client: StudyDbClient = prisma): Promise<void> {
  const subject = await client.subject.findUnique({
    where: { id: subjectId },
    select: { id: true },
  });

  if (!subject) {
    throw new ApiError("SUBJECT_NOT_FOUND", 404);
  }
}

interface TaskCommandPreimage extends TaskCasPreimage {
  subjectId: string;
  syllabusNodeId: string | null;
  parentTaskId: string | null;
  title: string;
  priority: DbTaskPriority;
  estimatedMinutes: number;
  actualMinutes: number;
  reviewText: string | null;
}

async function getTaskCommandPreimage(tx: Prisma.TransactionClient, id: string): Promise<TaskCommandPreimage> {
  const task = await tx.studyTask.findUnique({
    where: { id },
    select: {
      id: true,
      subjectId: true,
      syllabusNodeId: true,
      parentTaskId: true,
      title: true,
      type: true,
      status: true,
      priority: true,
      debtStatus: true,
      plannedDate: true,
      estimatedMinutes: true,
      actualMinutes: true,
      reviewText: true,
      completedAt: true,
      updatedAt: true,
    },
  });

  if (!task) throw new ApiError("TASK_NOT_FOUND", 404);
  return task;
}

function assertTaskSourceStatus(
  task: TaskCommandPreimage,
  allowed: DbTaskStatus[],
  requireIncomplete = false,
): void {
  if (!allowed.includes(task.status) || (requireIncomplete && task.completedAt !== null)) {
    throw new ApiError("TASK_STATE_CONFLICT", 409);
  }
}

async function getUpdatedTaskForResponse(tx: Prisma.TransactionClient, id: string) {
  const task = await tx.studyTask.findUnique({
    where: { id },
    include: {
      subject: true,
      syllabusNode: true,
    },
  });
  if (!task) throw new ApiError("TASK_STATE_CONFLICT", 409);
  return task;
}

async function getUpdatedSessionForResponse(tx: Prisma.TransactionClient, id: string) {
  const session = await tx.studySession.findUnique({
    where: { id },
    include: {
      subject: true,
      task: true,
      syllabusNode: true,
    },
  });
  if (!session) throw new ApiError("SESSION_STATE_CONFLICT", 409);
  return session;
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

async function createRuleRecoveryState(input: {
  plan: RecoveryPlan;
  actorId: string | null;
  topTask: StudyTaskDto | null;
  riskState: RiskState;
  debtCount: number;
  missedDays: number;
  effectiveMinutes: number;
  studyDayKey: string;
}): Promise<RecoveryStateRecord> {
  return prisma.$transaction(async (tx) => {
    await lockRecoveryState(tx);
    const activeState = await findActiveRecoveryState(tx);
    if (activeState) return activeState;

    return tx.recoveryState.create({
      data: {
        status: "active",
        triggerType: "rule",
        targetMinutes: normalizeRecoveryTargetMinutes(input.plan.minimumMinutes, 30),
        visibleTaskLimit: normalizeRecoveryVisibleTaskLimit(input.plan.visibleTaskLimit, 1),
        reason: input.plan.reason,
        actorId: input.actorId,
        metadata: {
          source: "dashboard_rule",
          action: input.plan.action,
          riskState: input.riskState,
          debtCount: input.debtCount,
          missedDays: input.missedDays,
          effectiveMinutes: input.effectiveMinutes,
          studyDayKey: input.studyDayKey,
          topTaskId: input.topTask?.id ?? null,
          topTaskTitle: input.topTask?.title ?? null,
        },
      },
    });
  });
}

async function finishRecoveryState(
  id: string,
  status: Exclude<DbRecoveryStateStatus, "active">,
  exitCondition: string | undefined,
  fallbackExitCondition: string,
): Promise<RecoveryStateDto> {
  const state = await prisma.$transaction(async (tx) => {
    await lockRecoveryState(tx);
    const existing = await tx.recoveryState.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new ApiError("RECOVERY_STATE_NOT_FOUND", 404);
    }
    if (existing.status !== "active") {
      if (existing.status === status) return existing;
      throw new ApiError("RECOVERY_STATE_ALREADY_FINISHED", 409);
    }

    return tx.recoveryState.update({
      where: { id },
      data: {
        status,
        endedAt: new Date(),
        exitCondition: normalizeOptionalText(exitCondition) ?? fallbackExitCondition,
      },
    });
  });

  return serializeRecoveryState(state);
}

async function findActiveRecoveryState(client: StudyDbClient = prisma): Promise<RecoveryStateRecord | null> {
  return client.recoveryState.findFirst({
    where: {
      status: "active",
    },
    orderBy: {
      startedAt: "desc",
    },
  });
}

async function lockRecoveryState(client: Prisma.TransactionClient): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${recoveryStateLockKey})`;
}

function createDashboardRecoveryFromRealtimePlan(plan: RecoveryPlan): TodayDashboardDto["recovery"] {
  return {
    stateId: null,
    source: "realtime_rule",
    active: plan.active,
    status: null,
    triggerType: null,
    minimumMinutes: plan.minimumMinutes,
    targetMinutes: plan.minimumMinutes,
    visibleTaskLimit: plan.visibleTaskLimit,
    reason: plan.reason,
    action: plan.action,
    startedAt: null,
    endedAt: null,
    exitCondition: null,
  };
}

function createDashboardRecoveryFromState(
  state: RecoveryStateRecord,
  topTask: StudyTaskDto | null,
): TodayDashboardDto["recovery"] {
  const status = toRecoveryStateStatus(state.status);
  const targetMinutes = normalizeRecoveryTargetMinutes(state.targetMinutes, 30);

  return {
    stateId: state.id,
    source: "state",
    active: status === "active",
    status,
    triggerType: toRecoveryTriggerType(state.triggerType),
    minimumMinutes: targetMinutes,
    targetMinutes,
    visibleTaskLimit: normalizeRecoveryVisibleTaskLimit(state.visibleTaskLimit, 1),
    reason: state.reason,
    action: createRecoveryStateAction(targetMinutes, topTask),
    startedAt: state.startedAt.toISOString(),
    endedAt: state.endedAt?.toISOString() ?? null,
    exitCondition: state.exitCondition,
  };
}

function serializeRecoveryState(state: RecoveryStateRecord): RecoveryStateDto {
  return {
    id: state.id,
    status: toRecoveryStateStatus(state.status),
    triggerType: toRecoveryTriggerType(state.triggerType),
    startedAt: state.startedAt.toISOString(),
    endedAt: state.endedAt?.toISOString() ?? null,
    targetMinutes: normalizeRecoveryTargetMinutes(state.targetMinutes, 30),
    visibleTaskLimit: normalizeRecoveryVisibleTaskLimit(state.visibleTaskLimit, 1),
    reason: state.reason,
    exitCondition: state.exitCondition,
    actorId: state.actorId,
  };
}

function toRecoveryStateStatus(status: string): DbRecoveryStateStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "canceled":
      return "canceled";
    default:
      return "active";
  }
}

function toRecoveryTriggerType(triggerType: string): DbRecoveryTriggerType {
  return triggerType === "manual" ? "manual" : "rule";
}

function createRecoveryStateAction(targetMinutes: number, topTask: StudyTaskDto | null): string {
  if (topTask) {
    return `今天只压「${topTask.title}」这个最小任务，先完成 ${targetMinutes} 分钟。`;
  }

  return `今天不补过去，先完成 ${targetMinutes} 分钟有效学习。`;
}

function normalizeRecoveryTargetMinutes(value: number | undefined, fallback: number): number {
  return normalizeBoundedInt(value, fallback, 5, 240);
}

function normalizeRecoveryVisibleTaskLimit(value: number | undefined, fallback: number): number {
  return normalizeBoundedInt(value, fallback, 1, 8);
}

function normalizeBoundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
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
