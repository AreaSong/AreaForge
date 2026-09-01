import {
  projectAppShellStatus,
  type AppShellLight,
  type AppShellStatusProjection,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { getStudyDayRange } from "./date";
import { findActiveWorkspaceOrNull } from "./exam-workspace-service";
import { listWorkspaceCheckIns } from "./check-in-service";
import { getActiveStudySession } from "./session-query-service";
import { getNotificationPreferences } from "./notification-preferences-service";
import type { StudySessionDto } from "@/lib/contracts";
import type { AppShellStatusDto } from "@/lib/contracts/app-shell";
import type { NotificationPreferenceDto } from "@/lib/contracts/notification";

export type { AppShellStatusDto } from "@/lib/contracts/app-shell";

function serializeStatus(
  projection: AppShellStatusProjection,
  extras: {
    serverTime: string;
    setupRequired: boolean;
    workspaceId: string | null;
    reviewExecutableCount: number;
    reviewBridgedCount: number;
    defaultSubjectId: string | null;
    notificationPreference: NotificationPreferenceDto;
    notificationCandidates: AppShellStatusDto["notificationCandidates"];
    motivationReminderCandidate: AppShellStatusDto["motivationReminderCandidate"];
    activeSession: StudySessionDto | null;
  },
): AppShellStatusDto {
  return {
    ...projection,
    ...extras,
  };
}

export async function getAppShellStatus(actorId: string): Promise<AppShellStatusDto> {
  const [workspace, notificationPreference] = await Promise.all([
    findActiveWorkspaceOrNull(actorId),
    getNotificationPreferences(actorId),
  ]);
  if (!workspace) {
    const empty = projectAppShellStatus({
      activity: {
        hasActive: false,
        isPaused: false,
        justCompleted: false,
        conflictOrUnknown: false,
        continueHref: "/today",
      },
      review: {
        executableCount: 0,
        bridgedCount: 0,
        overdueLearningDays: 0,
        blocked: false,
        inQuickReview: false,
        nextHref: "/knowledge/reviews",
      },
      debt: {
        countable: 0,
        severe: false,
        recoveryBlocked: false,
        arrangedComplete: false,
        debtHref: "/roadmap/allocation",
      },
      stage: {
        hasStage: false,
        inProgress: false,
        milestoneHealthy: false,
        milestoneNearOrDraftPending: false,
        conflictOrBlocked: false,
        stageHref: "/roadmap/stages",
      },
      todayClosure: {
        inReminderWindow: false,
        minimumActionDone: false,
        dailyReviewDone: false,
        minimumActionHref: "/today",
        reviewHref: "/roadmap/reviews/daily",
      },
    });
    return serializeStatus(empty, {
      serverTime: new Date().toISOString(),
      setupRequired: true,
      workspaceId: null,
      reviewExecutableCount: 0,
      reviewBridgedCount: 0,
      defaultSubjectId: null,
      notificationPreference,
      notificationCandidates: { reviewDue: false, planStart: false, eveningReview: false },
      motivationReminderCandidate: { trigger: null, blockedByActiveActivity: false },
      activeSession: null,
    });
  }

  const day = getStudyDayRange();
  const sevenDaysAgo = new Date(day.start.getTime() - 6 * 24 * 60 * 60 * 1000);

  const [
    activeSession,
    dueSchedules,
    bridgedTasks,
    debtTasks,
    todayPlanTasks,
    stagePlan,
    checkIns,
    dailyReview,
    defaultSubject,
    activeRecovery,
    lowConversionInbox,
  ] =
    await Promise.all([
      getActiveStudySession(actorId),
      prisma.reviewSchedule.findMany({
        where: {
          workspaceId: workspace.id,
          status: "ACTIVE",
          dueDate: { lte: day.end },
        },
        select: { id: true, dueDate: true },
      }),
      prisma.studyTask.findMany({
        where: {
          reviewScheduleId: { not: null },
          status: { in: ["TODO", "IN_PROGRESS"] },
          subject: { workspaceId: workspace.id },
          plannedDate: { lte: day.end },
        },
        select: { id: true, reviewScheduleId: true },
      }),
      prisma.studyTask.findMany({
        where: {
          subject: { workspaceId: workspace.id },
          status: { in: ["TODO", "IN_PROGRESS", "DEFERRED"] },
          OR: [
            { plannedDate: { lt: day.start } },
            { debtStatus: { not: "NONE" } },
          ],
        },
        select: { id: true, debtStatus: true, plannedDate: true },
      }),
      prisma.studyTask.findMany({
        where: {
          subject: { workspaceId: workspace.id },
          status: { in: ["TODO", "IN_PROGRESS"] },
          plannedDate: { gte: day.start, lt: day.end },
        },
        select: { id: true },
      }),
      prisma.stagePlan.findFirst({
        where: {
          workspaceId: workspace.id,
          status: { in: ["ACTIVE", "active", "DRAFT", "draft"] },
        },
        orderBy: { updatedAt: "desc" },
      }),
      listWorkspaceCheckIns(workspace.id, day.start, day.end).catch(() => []),
      prisma.dailyReview.findFirst({
        where: {
          reviewDate: { gte: day.start, lt: day.end },
          workspaceId: workspace.id,
        },
      }),
      prisma.subject.findFirst({
        where: { workspaceId: workspace.id, archivedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      }),
      prisma.recoveryState.findFirst({
        where: {
          userId: actorId,
          workspaceId: workspace.id,
          status: "ACTIVE",
          endedAt: null,
          OR: [{ windowEndDate: null }, { windowEndDate: { gte: day.start } }],
        },
        select: { id: true },
      }),
      prisma.planInboxItem.findFirst({
        where: {
          workspaceId: workspace.id,
          status: "OPEN",
          originType: "LOW_CONVERSION",
          supersededByItemId: null,
        },
        select: { id: true },
      }),
    ]);

  const bridgedScheduleIds = new Set(
    bridgedTasks.map((task) => task.reviewScheduleId).filter(Boolean) as string[],
  );
  const executableCount = dueSchedules.filter((schedule) => !bridgedScheduleIds.has(schedule.id)).length;
  const bridgedCount = bridgedTasks.length;

  let overdueLearningDays = 0;
  for (const schedule of dueSchedules) {
    if (!schedule.dueDate) continue;
    const overdue = Math.floor((day.start.getTime() - schedule.dueDate.getTime()) / (24 * 60 * 60 * 1000));
    overdueLearningDays = Math.max(overdueLearningDays, overdue);
  }

  const severeDebt = debtTasks.filter((task) =>
    ["STAGE_IMPACT", "PLAN_BREAKING", "stage_impact", "plan_breaking"].includes(task.debtStatus),
  ).length;

  const todayCheckIn = checkIns[0] ?? null;
  const hourShanghai = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
  const inReminderWindow = hourShanghai >= 20;

  const justCompleted = await prisma.studySession.findFirst({
    where: {
      status: "COMPLETED",
      endedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      subject: { workspaceId: workspace.id },
    },
    orderBy: { endedAt: "desc" },
  });

  void sevenDaysAgo;

  const projection = projectAppShellStatus({
    activity: {
      hasActive: Boolean(activeSession),
      isPaused: activeSession?.status === "paused",
      justCompleted: Boolean(justCompleted) && !activeSession,
      conflictOrUnknown: false,
      continueHref: activeSession ? `/focus` : "/today",
    },
    review: {
      executableCount,
      bridgedCount,
      overdueLearningDays,
      blocked: false,
      inQuickReview: false,
      nextHref: "/knowledge/reviews",
    },
    debt: {
      countable: debtTasks.length,
      severe: severeDebt > 0,
      recoveryBlocked: false,
      arrangedComplete: debtTasks.length === 0,
        debtHref: "/roadmap/allocation",
    },
    stage: {
      hasStage: Boolean(stagePlan) || Boolean(workspace.stageSummary),
      inProgress: Boolean(stagePlan) && !["completed", "COMPLETED", "archived", "ARCHIVED"].includes(stagePlan?.status ?? ""),
      milestoneHealthy: Boolean(stagePlan) && !["draft", "DRAFT"].includes(stagePlan?.status ?? ""),
      milestoneNearOrDraftPending: ["draft", "DRAFT"].includes(stagePlan?.status ?? ""),
      conflictOrBlocked: false,
        stageHref: "/roadmap/stages",
    },
    todayClosure: {
      inReminderWindow,
      minimumActionDone: todayCheckIn?.completedMinimumAction ?? false,
      dailyReviewDone: Boolean(dailyReview?.summary),
      minimumActionHref: "/today",
      reviewHref: "/roadmap/reviews/daily",
    },
  });

  return serializeStatus(projection, {
    serverTime: new Date().toISOString(),
    setupRequired: false,
    workspaceId: workspace.id,
    reviewExecutableCount: executableCount,
    reviewBridgedCount: bridgedCount,
    defaultSubjectId: defaultSubject?.id ?? null,
    notificationPreference,
    notificationCandidates: {
      reviewDue: executableCount > 0,
      planStart: todayPlanTasks.length > 0,
      eveningReview: !dailyReview?.summary,
    },
    motivationReminderCandidate: {
      trigger: activeRecovery ? "RECOVERY" : lowConversionInbox ? "LOW_CONVERSION" : null,
      blockedByActiveActivity: Boolean(activeSession),
    },
    activeSession,
  });
}

export type { AppShellLight };
