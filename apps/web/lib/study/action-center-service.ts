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
import { getStudyDayRange } from "./date";
import {
  findActiveWorkspaceOrNull,
  type ExamWorkspaceDto,
} from "./exam-workspace-service";
import { listWorkspaceCheckIns, type CheckInV2Dto } from "./check-in-service";
import { getActiveRecoveryV2, type RecoveryV2Dto } from "./recovery-v2-service";
import { getActiveStudySession } from "./service";
import type { StudySessionDto } from "./types";

export interface ActionCenterTodayDto {
  setupRequired: boolean;
  workspace: ExamWorkspaceDto | null;
  recommendation: ActionCenterRecommendation | null;
  queues: ActionCenterQueues;
  queuesEmpty: boolean;
  subjectTimers: SubjectTimerSummary;
  activity: StudySessionDto | null;
  recovery: RecoveryV2Dto | null;
  checkIn: CheckInV2Dto | null;
  statusBar:
    | "setup"
    | "paused_activity"
    | "recovery_minimum"
    | "evening_review"
    | null;
  primaryActionLabel: string;
  primaryActionHref: string;
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

export async function getActionCenterToday(actorId: string): Promise<ActionCenterTodayDto> {
  const workspace = await findActiveWorkspaceOrNull(actorId);
  if (!workspace) {
    return {
      setupRequired: true,
      workspace: null,
      recommendation: null,
      queues: { formalTasks: [], noteResourceSyllabusReviews: [], mistakeReviews: [] },
      queuesEmpty: true,
      subjectTimers: { subjects: [], groups: [] },
      activity: null,
      recovery: null,
      checkIn: null,
      statusBar: "setup",
      primaryActionLabel: "设置考试目标",
      primaryActionHref: "/settings/workspace?setup=1",
    };
  }

  const day = getStudyDayRange();
  const last7Start = new Date(day.start.getTime() - 6 * 24 * 60 * 60 * 1000);

  const [activeSession, subjects, groups, tasks, schedules, checkIns, recovery] =
    await Promise.all([
      getActiveStudySession(),
      prisma.subject.findMany({
        where: { workspaceId: workspace.id },
        include: { group: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.subjectGroup.findMany({
        where: { workspaceId: workspace.id, archivedAt: null },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.studyTask.findMany({
        where: {
          subject: { workspaceId: workspace.id },
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

  if (recovery) {
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
      href: `/today/tasks/${task.id}`,
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
      title: `${objectKind} 复习`,
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
  else if (recovery) statusBar = "recovery_minimum";
  else {
    const hourShanghai = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
    if (hourShanghai >= 20 && !(checkIn?.completedMinimumAction)) statusBar = "evening_review";
  }

  let primaryActionLabel = "创建今天最小任务";
  let primaryActionHref = "/today/plan?createMinimum=1";
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
    primaryActionHref = "/today/plan?createMinimum=1";
  }

  return {
    setupRequired: false,
    workspace: serializeWorkspace(workspace),
    recommendation,
    queues,
    queuesEmpty: empty,
    subjectTimers,
    activity: activeSession,
    recovery,
    checkIn,
    statusBar,
    primaryActionLabel,
    primaryActionHref,
  };
}
