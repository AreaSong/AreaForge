import {
  buildDailyCheckInSnapshot,
  createDashboardSnapshot,
  createRecoveryPlan,
  evaluateMotivationWake,
  evaluateStageLevel,
  evaluateDailyCheckIn,
  getTimerElapsedSeconds,
  rankRecoveryTaskCandidates,
  suggestTaskDebtReorder,
  type DashboardInput,
  type RiskState,
  type StudyTaskInput,
  type TaskDebtReorderPressure,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { cache } from "react";
import { daysUntil, getStudyDayRange } from "./date";
import { finalExamDate, simulationDate } from "./exam-dates";
import { listCheckInSnapshotsInRange } from "./check-in-service";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import {
  createDashboardRecoveryFromRealtimePlan,
  createDashboardRecoveryFromState,
  createRuleRecoveryState,
  findActiveRecoveryState,
} from "./recovery-state-service";
import { serializeDailyReview } from "./daily-review-serializer";
import { serializeSession } from "./session-serializer";
import { getEffectiveStudyStreak } from "./study-day-metrics";
import { serializeSubject } from "./subject-serializer";
import { serializeTask } from "./task-serializer";
import type { GetTodayDashboardOptions } from "./study-service-contracts";
import type {
  StudySessionDto,
  StudyTaskDto,
  SyllabusOverviewDto,
  TaskDebtReorderDto,
  TodayDashboardDto,
} from "@/lib/contracts";


export async function getTodayDashboard(
  actorId: string,
  now = new Date(),
  options: GetTodayDashboardOptions = {},
): Promise<TodayDashboardDto> {
  const workspace = await resolveActiveWorkspace(actorId);
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
      where: { workspaceId: workspace.id, archivedAt: null },
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
        subject: { workspaceId: workspace.id, archivedAt: null },
        plannedDate: {
          gte: day.start,
          lt: day.end,
        },
      },
      include: {
        subject: true,
        syllabusNode: true,
        stageLinks: { include: { stagePlan: { select: { name: true } } } },
        knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    }),
    prisma.studySession.findMany({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        startedAt: {
          gte: day.start,
          lt: day.end,
        },
      },
      include: {
        subject: true,
        task: true,
        syllabusNode: true,
        closeout: true,
        devicePresences: true,
        knowledgeLinks: { include: { knowledgePoint: { select: { id: true, title: true, masteryState: true } } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { startedAt: "asc" },
    }),
    prisma.studySession.findFirst({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        status: {
          in: ["RUNNING", "PAUSED", "CLOSING"],
        },
      },
      include: {
        subject: true,
        task: true,
        syllabusNode: true,
        closeout: true,
        devicePresences: true,
        knowledgeLinks: { include: { knowledgePoint: { select: { id: true, title: true, masteryState: true } } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { startedAt: "desc" },
    }),
    prisma.dailyReview.findFirst({
      where: { reviewDate: day.start, workspaceId: workspace.id },
    }),
    prisma.studyTask.count({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
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
        subject: { workspaceId: workspace.id, archivedAt: null },
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
        stageLinks: { include: { stagePlan: { select: { name: true } } } },
        knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
      },
      orderBy: [{ priority: "desc" }, { plannedDate: "asc" }],
      take: 12,
    }),
    prisma.studySession.findMany({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
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
    listCheckInSnapshotsInRange(recentStart, day.end, prisma, workspace.id),
    prisma.motivationVault.findFirst({
      orderBy: { createdAt: "asc" },
    }),
    findActiveRecoveryState(),
  ]);

  const sessionDtos = todaySessions.map((session) => serializeSession(session));
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
        actorId,
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
    review: review ? serializeDailyReview(review) : null,
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
export const getTodayDashboardShared = cache(
  async (actorId: string): Promise<TodayDashboardDto> => getTodayDashboard(actorId),
);

export async function getTaskDebtReorderSuggestion(actorId: string, now = new Date()): Promise<TaskDebtReorderDto> {
  const dashboard = await getTodayDashboard(actorId, now);
  return dashboard.debtReorder;
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

function isMajorReview(review: { summary: string | null; lostControl: string | null } | null): boolean {
  if (!review) return false;

  const text = `${review.summary ?? ""}\n${review.lostControl ?? ""}`.trim();
  if (text.length < 24) return false;

  return /重大|失控|崩|断签|放弃|危险|拖延|熬夜|崩盘/.test(text);
}

function sumTodayMinutes(sessions: StudySessionDto[], activeSession: StudySessionDto | null, now: Date): number {
  const completedMinutes = sessions.reduce((total, session) => total + session.effectiveMinutes, 0);
  if (!activeSession || activeSession.status === "completed" || activeSession.status === "canceled" || activeSession.status === "closing") {
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
