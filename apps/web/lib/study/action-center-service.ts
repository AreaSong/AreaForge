import {
  buildSubjectTimerSummaries,
  classifyReviewPriorityBand,
  classifyTaskPriorityBand,
  isHardBlocked,
  partitionActionCenterQueues,
  queuesAreEmpty,
  selectActionCenterRecommendation,
  type ActionCenterCandidate,
  type ActionCenterQueues,
  type ActionCenterRecommendation,
  type SubjectTimerSummary,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { getStudyDayRange, parseStudyDayKey } from "./date";
import {
  findActiveWorkspaceOrNull,
  type ExamWorkspaceDto,
} from "./exam-workspace-service";
import { listWorkspaceCheckIns, type CheckInV2Dto } from "./check-in-service";
import { getActiveRecoveryV2, type RecoveryV2Dto } from "./recovery-v2-service";
import { getActiveStudySession } from "./service";
import { listSyllabusOptions } from "./syllabus-service";
import type { StudySessionDto, SyllabusOptionNodeDto } from "./types";

export interface SubjectShortcutTaskOptionDto {
  id: string;
  subjectId: string;
  title: string;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  disabledReason: string | null;
}

export interface ActionCenterTodayDto {
  studyDate: string;
  isToday: boolean;
  setupRequired: boolean;
  workspace: ExamWorkspaceDto | null;
  recommendation: ActionCenterRecommendation | null;
  queues: ActionCenterQueues;
  queuesEmpty: boolean;
  subjectTimers: SubjectTimerSummary;
  activity: StudySessionDto | null;
  recovery: RecoveryV2Dto | null;
  checkIn: CheckInV2Dto | null;
  shortcutOptions: {
    tasks: SubjectShortcutTaskOptionDto[];
    syllabusNodes: SyllabusOptionNodeDto[];
  };
  statusBar:
    | "setup"
    | "paused_activity"
    | "recovery_minimum"
    | "evening_review"
    | null;
  primaryActionLabel: string;
  primaryActionHref: string;
  learningLoop: {
    plannedTaskCount: number;
    completedTaskCount: number;
    deferredTaskCount: number;
    effectiveMinutes: number;
    totalMinutes: number;
    effectiveSessionCount: number;
    lowConversionCount: number;
    reviewSubmitted: boolean;
    nextAction: string | null;
  };
}

const REVIEW_CANDIDATE_TITLES = {
  NOTE: "卡片复习",
  MISTAKE: "错题复习",
  STUDY_RESOURCE: "资料复习",
  SYLLABUS_NODE: "考纲节点复习",
} as const;

function reviewCandidateTitle(targetType: string): string {
  return REVIEW_CANDIDATE_TITLES[targetType as keyof typeof REVIEW_CANDIDATE_TITLES] ?? "知识对象复习";
}

function serializeWorkspace(row: {
  id: string;
  stableKey: string;
  name: string;
  targetExamDate: Date | null;
  stageSummary: string | null;
  status: "ACTIVE" | "ARCHIVED";
  revision: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ExamWorkspaceDto {
  return {
    id: row.id,
    stableKey: row.stableKey,
    name: row.name,
    targetExamDate: row.targetExamDate?.toISOString() ?? null,
    stageSummary: row.stageSummary,
    status: row.status,
    revision: row.revision,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getActionCenterToday(actorId: string, requestedStudyDate?: string | null): Promise<ActionCenterTodayDto> {
  const todayRange = getStudyDayRange();
  const selectedDate = parseStudyDayKey(requestedStudyDate) ?? todayRange.start;
  const workspace = await findActiveWorkspaceOrNull(actorId);
  if (!workspace) {
    return {
      studyDate: getStudyDayRange(selectedDate).key,
      isToday: getStudyDayRange(selectedDate).key === todayRange.key,
      setupRequired: true,
      workspace: null,
      recommendation: null,
      queues: { formalTasks: [], noteResourceSyllabusReviews: [], mistakeReviews: [] },
      queuesEmpty: true,
      subjectTimers: { subjects: [], groups: [] },
      activity: null,
      recovery: null,
      checkIn: null,
      shortcutOptions: { tasks: [], syllabusNodes: [] },
      statusBar: "setup",
      primaryActionLabel: "设置考试目标",
      primaryActionHref: "/settings/workspace?setup=1",
      learningLoop: {
        plannedTaskCount: 0,
        completedTaskCount: 0,
        deferredTaskCount: 0,
        effectiveMinutes: 0,
        totalMinutes: 0,
        effectiveSessionCount: 0,
        lowConversionCount: 0,
        reviewSubmitted: false,
        nextAction: null,
      },
    };
  }

  const day = getStudyDayRange(selectedDate);
  const last7Start = new Date(day.start.getTime() - 6 * 24 * 60 * 60 * 1000);

  const [activeSession, subjects, groups, tasks, dayTasks, shortcutTasks, syllabusOptions, schedules, checkIns, recovery, completedSessions] =
    await Promise.all([
      getActiveStudySession(actorId),
      prisma.subject.findMany({
        where: { workspaceId: workspace.id, archivedAt: null },
        include: { group: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.subjectGroup.findMany({
        where: { workspaceId: workspace.id, archivedAt: null },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.studyTask.findMany({
        where: {
          subject: { workspaceId: workspace.id, archivedAt: null },
          status: { in: ["TODO", "IN_PROGRESS"] },
          plannedDate: { lte: day.end },
        },
        include: {
          subject: true,
          successorDependencies: {
            include: { predecessor: { select: { id: true, status: true, title: true } } },
          },
        },
        orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
      }),
      prisma.studyTask.findMany({
        where: {
          subject: { workspaceId: workspace.id, archivedAt: null },
          plannedDate: { gte: day.start, lt: day.end },
        },
        select: { status: true },
      }),
      prisma.studyTask.findMany({
        where: {
          subject: { workspaceId: workspace.id, archivedAt: null },
          status: { in: ["TODO", "IN_PROGRESS"] },
        },
        include: {
          syllabusNode: { select: { title: true } },
          successorDependencies: {
            include: { predecessor: { select: { status: true, title: true } } },
          },
        },
        orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
        take: 200,
      }),
      listSyllabusOptions(actorId),
      prisma.reviewSchedule.findMany({
        where: {
          workspaceId: workspace.id,
          status: "ACTIVE",
          dueDate: { lte: day.end },
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      }),
      listWorkspaceCheckIns(workspace.id, day.start, day.end),
      getActiveRecoveryV2(actorId).catch(() => null),
      prisma.studySession.findMany({
        where: {
          subject: { workspaceId: workspace.id, archivedAt: null },
          startedAt: { gte: day.start, lt: day.end },
          status: "COMPLETED",
        },
        orderBy: { endedAt: "desc" },
        select: {
          nextAction: true,
          effectiveMinutes: true,
          isEffective: true,
          isLowConversion: true,
        },
      }),
    ]);

  const sessionsLast7 = await prisma.studySession.findMany({
    where: {
      status: "COMPLETED",
      startedAt: { gte: last7Start, lt: day.end },
      subjectId: { in: subjects.map((subject) => subject.id) },
      isEffective: true,
    },
    select: { subjectId: true, effectiveMinutes: true, startedAt: true },
  });

  const todayMinutesBySubject = new Map<string, number>();
  const last7MinutesBySubject = new Map<string, number>();
  for (const session of sessionsLast7) {
    last7MinutesBySubject.set(
      session.subjectId,
      (last7MinutesBySubject.get(session.subjectId) ?? 0) + session.effectiveMinutes,
    );
    if (session.startedAt >= day.start) {
      todayMinutesBySubject.set(
        session.subjectId,
        (todayMinutesBySubject.get(session.subjectId) ?? 0) + session.effectiveMinutes,
      );
    }
  }

  const subjectTimers = buildSubjectTimerSummaries({
    subjects: subjects.map((subject) => {
      const openTask = tasks.find((task) => task.subjectId === subject.id);
      return {
        subjectId: subject.id,
        title: subject.name,
        groupId: subject.groupId,
        groupTitle: subject.group?.name ?? null,
        archived: Boolean(subject.archivedAt),
        todayEffectiveMinutes: todayMinutesBySubject.get(subject.id) ?? 0,
        last7EffectiveMinutes: last7MinutesBySubject.get(subject.id) ?? 0,
        contextSummary: openTask?.title ?? null,
        canStart: !subject.archivedAt && !activeSession,
      };
    }),
    groups: groups.map((group) => {
      const memberIds = subjects.filter((subject) => subject.groupId === group.id).map((subject) => subject.id);
      return {
        groupId: group.id,
        title: group.name,
        todayEffectiveMinutes: memberIds.reduce(
          (sum, id) => sum + (todayMinutesBySubject.get(id) ?? 0),
          0,
        ),
        last7EffectiveMinutes: memberIds.reduce(
          (sum, id) => sum + (last7MinutesBySubject.get(id) ?? 0),
          0,
        ),
      };
    }),
  });
  const shortcutTaskOptions: SubjectShortcutTaskOptionDto[] = shortcutTasks.map((task) => {
    const blockers = task.successorDependencies.filter((dependency) =>
      dependency.type === "HARD" && dependency.predecessor.status !== "DONE",
    );
    return {
      id: task.id,
      subjectId: task.subjectId,
      title: task.title,
      syllabusNodeId: task.syllabusNodeId,
      syllabusNodeTitle: task.syllabusNode?.title ?? null,
      disabledReason: blockers.length
        ? `硬依赖未完成：${blockers.map((dependency) => dependency.predecessor.title).join("、")}`
        : null,
    };
  });

  const candidates: ActionCenterCandidate[] = [];

  if (activeSession) {
    candidates.push({
      id: activeSession.id,
      kind: "activity",
      title: activeSession.status === "paused" ? "继续当前活动" : "继续专注",
      reason: "已有进行中或暂停的活动",
      priorityBand: "continue_activity",
      riskScore: 100,
      overdueDays: 0,
      estimatedMinutes: 0,
      createdAtMs: new Date(activeSession.startedAt).getTime(),
      hardBlocked: false,
      softDependencyHint: null,
      bridgedReviewScheduleId: null,
      reviewObjectKind: null,
      taskPriority: null,
      href: `/focus/${activeSession.id}`,
    });
  }

  if (recovery?.effectiveStatus === "ACTIVE") {
    candidates.push({
      id: recovery.id,
      kind: "recovery",
      title: `恢复第 ${recovery.currentStage} 阶 · ${recovery.targetMinutes} 分钟`,
      reason: recovery.reason || "当前处于恢复模式，先完成一个最小行动",
      priorityBand: "recovery_candidate",
      riskScore: 80,
      overdueDays: 0,
      estimatedMinutes: recovery.targetMinutes,
      createdAtMs: new Date(recovery.startedAt).getTime(),
      hardBlocked: false,
      softDependencyHint: null,
      bridgedReviewScheduleId: null,
      reviewObjectKind: null,
      taskPriority: null,
      href: "/today",
    });
  }

  for (const task of tasks) {
    const overdueDays = Math.max(
      0,
      Math.floor((day.start.getTime() - task.plannedDate.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const hardDeps = task.successorDependencies.filter((dep) => dep.type === "HARD");
    const softDeps = task.successorDependencies.filter((dep) => dep.type === "SOFT");
    const hardBlocked = hardDeps.some((dep) =>
      isHardBlocked({
        predecessorStatus: dep.predecessor.status as "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED",
        dependencyType: "HARD",
      }),
    );
    const softHint = softDeps
      .filter((dep) => dep.predecessor.status !== "DONE")
      .map((dep) => `软依赖未完成：${dep.predecessor.title}`)
      .join("；");
    const priority = task.priority.toLowerCase() as "low" | "medium" | "high" | "critical";
    const plannedForToday = task.plannedDate >= day.start && task.plannedDate < day.end;

    candidates.push({
      id: task.id,
      kind: "task",
      title: task.title,
      reason: hardBlocked
        ? `硬依赖阻塞：${hardDeps.map((dep) => dep.predecessor.title).join("、")}`
        : overdueDays > 0
          ? `逾期 ${overdueDays} 天`
          : plannedForToday
            ? "今日计划任务"
            : "待处理任务",
      priorityBand: classifyTaskPriorityBand({ overdueDays, taskPriority: priority, plannedForToday }),
      riskScore: overdueDays * 10 + (priority === "critical" ? 8 : priority === "high" ? 5 : 1),
      overdueDays,
      estimatedMinutes: task.estimatedMinutes,
      createdAtMs: task.createdAt.getTime(),
      hardBlocked,
      softDependencyHint: softHint || null,
      bridgedReviewScheduleId: task.reviewScheduleId,
      reviewObjectKind: null,
      taskPriority: priority,
      href: `/plan/tasks/${task.id}`,
    });
  }

  for (const schedule of schedules) {
    const overdueDays = schedule.dueDate
      ? Math.max(0, Math.floor((day.start.getTime() - schedule.dueDate.getTime()) / (24 * 60 * 60 * 1000)))
      : 0;
    const objectKind = schedule.targetType as "NOTE" | "MISTAKE" | "STUDY_RESOURCE" | "SYLLABUS_NODE";
    candidates.push({
      id: schedule.id,
      kind: "review",
      title: reviewCandidateTitle(objectKind),
      reason: overdueDays > 0 ? `复习逾期 ${overdueDays} 天` : "今日到期复习",
      priorityBand: classifyReviewPriorityBand(objectKind),
      riskScore: overdueDays * 8 + (objectKind === "MISTAKE" ? 6 : 2),
      overdueDays,
      estimatedMinutes: 15,
      createdAtMs: schedule.createdAt.getTime(),
      hardBlocked: false,
      softDependencyHint: null,
      bridgedReviewScheduleId: null,
      reviewObjectKind: objectKind,
      taskPriority: null,
      href: `/quick-review/${schedule.id}`,
    });
  }

  const recommendation = selectActionCenterRecommendation(candidates);
  const queues = partitionActionCenterQueues(candidates);
  const empty = queuesAreEmpty(queues);
  const checkIn = checkIns[0] ?? null;

  let statusBar: ActionCenterTodayDto["statusBar"] = null;
  if (activeSession?.status === "paused") statusBar = "paused_activity";
  else if (recovery?.effectiveStatus === "ACTIVE") statusBar = "recovery_minimum";
  else {
    const hourShanghai = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
    if (day.key === todayRange.key && hourShanghai >= 20 && !(checkIn?.completedMinimumAction)) statusBar = "evening_review";
  }

  let primaryActionLabel = "创建今天最小任务";
  let primaryActionHref = "/plan?createMinimum=1";
  if (recommendation) {
    primaryActionLabel =
      recommendation.kind === "activity"
        ? "继续当前行动"
        : recommendation.kind === "review"
          ? "开始复习"
          : recommendation.kind === "recovery"
            ? "开始最小恢复行动"
            : "开始当前行动";
    primaryActionHref = recommendation.href;
  } else if (empty) {
    primaryActionLabel = "创建今天最小任务";
    primaryActionHref = "/plan?createMinimum=1";
  }

  const snapshot = checkIn ?? null;
  const completedTaskCount = dayTasks.filter((task) => task.status === "DONE").length;
  const deferredTaskCount = dayTasks.filter((task) => task.status === "DEFERRED" || task.status === "SKIPPED").length;
  const fallbackTotalMinutes = completedSessions.reduce((sum, session) => sum + session.effectiveMinutes, 0);
  const fallbackEffectiveMinutes = completedSessions.reduce(
    (sum, session) => sum + (session.isEffective ? session.effectiveMinutes : 0),
    0,
  );
  const fallbackEffectiveSessionCount = completedSessions.filter((session) => session.isEffective).length;
  const fallbackLowConversionCount = completedSessions.filter((session) => session.isLowConversion).length;

  return {
    studyDate: day.key,
    isToday: day.key === todayRange.key,
    setupRequired: false,
    workspace: serializeWorkspace(workspace),
    recommendation,
    queues,
    queuesEmpty: empty,
    subjectTimers,
    activity: activeSession,
    recovery,
    checkIn,
    shortcutOptions: { tasks: shortcutTaskOptions, syllabusNodes: syllabusOptions },
    statusBar,
    primaryActionLabel,
    primaryActionHref,
    learningLoop: {
      plannedTaskCount: dayTasks.length,
      completedTaskCount,
      deferredTaskCount,
      effectiveMinutes: snapshot?.effectiveMinutes ?? fallbackEffectiveMinutes,
      totalMinutes: snapshot?.totalMinutes ?? fallbackTotalMinutes,
      effectiveSessionCount: snapshot?.effectiveSessionCount ?? fallbackEffectiveSessionCount,
      lowConversionCount: snapshot?.lowConversionCount ?? fallbackLowConversionCount,
      reviewSubmitted: snapshot?.reviewSubmitted ?? false,
      nextAction: completedSessions.find((session) => session.nextAction?.trim())?.nextAction?.trim() ?? null,
    },
  };
}
