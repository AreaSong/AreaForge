import {
  projectAppShellStatus,
  type AppShellLight,
  type AppShellStatusProjection,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { getStudyDayRange } from "./date";
import { findActiveWorkspaceOrNull } from "./exam-workspace-service";
import { listWorkspaceCheckIns } from "./check-in-service";
import { getActiveStudySession } from "./service";

export interface AppShellStatusDto extends AppShellStatusProjection {
  setupRequired: boolean;
  workspaceId: string | null;
  reviewExecutableCount: number;
  reviewBridgedCount: number;
}

function serializeStatus(
  projection: AppShellStatusProjection,
  extras: {
    setupRequired: boolean;
    workspaceId: string | null;
    reviewExecutableCount: number;
    reviewBridgedCount: number;
  },
): AppShellStatusDto {
  return {
    ...projection,
    ...extras,
  };
}

export async function getAppShellStatus(actorId: string): Promise<AppShellStatusDto> {
  const workspace = await findActiveWorkspaceOrNull(actorId);
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
        nextHref: "/today",
      },
      debt: {
        countable: 0,
        severe: false,
        recoveryBlocked: false,
        arrangedComplete: false,
        debtHref: "/today/plan",
      },
      stage: {
        hasStage: false,
        inProgress: false,
        milestoneHealthy: false,
        milestoneNearOrDraftPending: false,
        conflictOrBlocked: false,
        stageHref: "/today",
      },
      todayClosure: {
        inReminderWindow: false,
        minimumActionDone: false,
        dailyReviewDone: false,
        minimumActionHref: "/today",
        reviewHref: "/today",
      },
    });
    return serializeStatus(empty, {
      setupRequired: true,
      workspaceId: null,
      reviewExecutableCount: 0,
      reviewBridgedCount: 0,
    });
  }

  const day = getStudyDayRange();
  const sevenDaysAgo = new Date(day.start.getTime() - 6 * 24 * 60 * 60 * 1000);

  const [activeSession, dueSchedules, bridgedTasks, debtTasks, stagePlan, checkIns, dailyReview] =
    await Promise.all([
      getActiveStudySession(),
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
      prisma.stagePlan.findFirst({
        where: {
          OR: [{ workspaceId: workspace.id }, { workspaceId: null }],
          status: { in: ["ACTIVE", "active", "DRAFT", "draft"] },
        },
        orderBy: { updatedAt: "desc" },
      }),
      listWorkspaceCheckIns(workspace.id, day.start, day.end).catch(() => []),
      prisma.dailyReview.findFirst({
        where: {
          reviewDate: { gte: day.start, lt: day.end },
          OR: [{ workspaceId: workspace.id }, { workspaceId: null }],
        },
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
      continueHref: activeSession ? `/focus/${activeSession.id}` : "/today",
    },
    review: {
      executableCount,
      bridgedCount,
      overdueLearningDays,
      blocked: false,
      inQuickReview: false,
      nextHref: "/today",
    },
    debt: {
      countable: debtTasks.length,
      severe: severeDebt > 0,
      recoveryBlocked: false,
      arrangedComplete: debtTasks.length === 0,
      debtHref: "/today/plan",
    },
    stage: {
      hasStage: Boolean(stagePlan) || Boolean(workspace.stageSummary),
      inProgress: Boolean(stagePlan) && !["completed", "COMPLETED", "archived", "ARCHIVED"].includes(stagePlan?.status ?? ""),
      milestoneHealthy: Boolean(stagePlan) && !["draft", "DRAFT"].includes(stagePlan?.status ?? ""),
      milestoneNearOrDraftPending: ["draft", "DRAFT"].includes(stagePlan?.status ?? ""),
      conflictOrBlocked: false,
      stageHref: "/today",
    },
    todayClosure: {
      inReminderWindow,
      minimumActionDone: todayCheckIn?.completedMinimumAction ?? false,
      dailyReviewDone: Boolean(dailyReview?.summary),
      minimumActionHref: "/today",
      reviewHref: "/today",
    },
  });

  return serializeStatus(projection, {
    setupRequired: false,
    workspaceId: workspace.id,
    reviewExecutableCount: executableCount,
    reviewBridgedCount: bridgedCount,
  });
}

export type { AppShellLight };
