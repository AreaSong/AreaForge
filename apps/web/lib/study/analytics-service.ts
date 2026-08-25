import {
  buildDailyCheckInSnapshot,
  summarizeAnalyticsRisks,
  type AnalyticsRiskSummaryItem,
  type TaskStatus,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { cache } from "react";
import type {
  AnalyticsDailyPointDto,
  AnalyticsRiskItemDto,
  AnalyticsSubjectShareDto,
  AnalyticsSummaryDto,
} from "@/lib/contracts/analytics";
import { listCheckInSnapshotsInRange } from "./check-in-service";
import { getStudyDayKey, getStudyDayRange } from "./date";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import { aggregateActivityBreakdown, emptyActivityBreakdown } from "./activity-metrics";
import type { SyllabusNodeStatusDto } from "@/lib/contracts";

export type {
  AnalyticsDailyPointDto,
  AnalyticsRiskItemDto,
  AnalyticsSubjectShareDto,
  AnalyticsSummaryDto,
} from "@/lib/contracts/analytics";

const dayMs = 24 * 60 * 60 * 1000;
const weekDays = 7;

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type DbSyllabusNodeStatus = "NOT_STARTED" | "LEARNING" | "COVERED" | "NEEDS_REVIEW" | "MASTERED" | "WEAK" | "DEFERRED";

// 同一次服务端渲染内的只读共享副本，供 AI 建议与长期风险等多个消费方复用同一份统计结果。
export const getAnalyticsSummaryShared = cache(
  async (actorId: string): Promise<AnalyticsSummaryDto> => getAnalyticsSummary(new Date(), actorId),
);

export async function getAnalyticsSummary(
  now = new Date(),
  actorId: string,
  windowDays: 7 | 30 = weekDays,
): Promise<AnalyticsSummaryDto> {
  const today = getStudyDayRange(now);
  const start = new Date(today.start.getTime() - (windowDays - 1) * dayMs);
  const reviewLookaheadEnd = new Date(today.end.getTime() + 3 * dayMs);
  const workspace = await resolveActiveWorkspace(actorId);
  const subjectScope = { subject: { workspaceId: workspace.id } };

  const [
    subjects,
    sessions,
    tasks,
    reviews,
    totalMistakes,
    dueMistakes,
    dueNotes,
    weakNodes,
    reviewRiskNodes,
    checkInSnapshots,
  ] = await Promise.all([
    prisma.subject.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.studySession.findMany({
      where: {
        startedAt: {
          gte: start,
          lt: today.end,
        },
        status: "COMPLETED",
        ...subjectScope,
      },
      include: {
        subject: true,
      },
    }),
    prisma.studyTask.findMany({
      where: {
        plannedDate: {
          gte: start,
          lt: today.end,
        },
        ...subjectScope,
      },
      include: {
        subject: true,
      },
    }),
    prisma.dailyReview.findMany({
      where: {
        reviewDate: {
          gte: start,
          lt: today.end,
        },
        ...(workspace ? { workspaceId: workspace.id } : {}),
      },
      orderBy: { reviewDate: "asc" },
    }),
    prisma.mistake.count({ where: subjectScope }),
    prisma.mistake.findMany({
      where: {
        nextReviewAt: {
          lte: reviewLookaheadEnd,
        },
        ...subjectScope,
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
      orderBy: [{ nextReviewAt: "asc" }, { updatedAt: "desc" }],
      take: 8,
    }),
    prisma.note.findMany({
      where: {
        nextReviewAt: {
          lte: reviewLookaheadEnd,
        },
        ...subjectScope,
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
      orderBy: [{ nextReviewAt: "asc" }, { updatedAt: "desc" }],
      take: 8,
    }),
    prisma.syllabusNode.findMany({
      where: {
        OR: [{ status: "WEAK" }, { status: "NEEDS_REVIEW" }],
        ...(workspace ? { subject: { workspaceId: workspace.id } } : {}),
      },
      include: {
        subject: true,
        _count: {
          select: {
            tasks: true,
            sessions: true,
            notes: true,
            mistakes: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 8,
    }),
    prisma.syllabusNode.findMany({
      where: {
        mistakes: {
          some: {},
        },
        ...(workspace ? { subject: { workspaceId: workspace.id } } : {}),
      },
      include: {
        subject: true,
        _count: {
          select: {
            tasks: true,
            sessions: true,
            notes: true,
            mistakes: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 8,
    }),
    listCheckInSnapshotsInRange(start, today.end, prisma, workspace?.id ?? null),
  ]);

  const dailySnapshots = buildDailySnapshots(start, sessions, tasks, reviews, checkInSnapshots, windowDays);
  const daily = dailySnapshots.map((snapshot) => {
    const day = getStudyDayRange(new Date(`${snapshot.studyDate}T00:00:00+08:00`));
    const activity = aggregateActivityBreakdown(sessions.filter((session) => session.startedAt >= day.start && session.startedAt < day.end));
    return {
      dayKey: snapshot.studyDate,
      totalMinutes: snapshot.totalMinutes,
      effectiveMinutes: snapshot.effectiveMinutes,
      taskCompletionRate: snapshot.taskCompletionRate,
      reviewSubmitted: snapshot.reviewSubmitted,
      activity,
    };
  });
  const todayPoint = daily[daily.length - 1] ?? {
    totalMinutes: 0,
    effectiveMinutes: 0,
    taskCompletionRate: 0,
    activity: emptyActivityBreakdown(),
  };
  const weekMinutes = daily.reduce((total, point) => total + point.totalMinutes, 0);
  const weekEffectiveMinutes = daily.reduce((total, point) => total + point.effectiveMinutes, 0);
  const weeklyTaskCompletionRate = averageDailyTaskCompletion(dailySnapshots);
  const reviewCompletionRate = dailySnapshots.filter((snapshot) => snapshot.reviewSubmitted).length / windowDays;
  const streakDays = calculateStreak(daily);
  const missedDays = daily.filter((point) => point.effectiveMinutes === 0).length;
  const lowConversionCount = dailySnapshots.reduce((total, snapshot) => total + snapshot.lowConversionCount, 0);
  const weakNodeMap = new Map(weakNodes.map((node) => [node.id, node]));

  for (const node of reviewRiskNodes) {
    if (node._count.mistakes >= 2 && !weakNodeMap.has(node.id)) {
      weakNodeMap.set(node.id, node);
    }
  }

  const riskSummary = summarizeAnalyticsRisks({
    weekEffectiveMinutes,
    weeklyTaskCompletionRate,
    reviewCompletionRate,
    dueMistakes: dueMistakes.map((mistake) => ({
      id: mistake.id,
      title: mistake.title,
      subjectName: mistake.subject.name,
      dueAt: mistake.nextReviewAt,
      syllabusNodeId: mistake.syllabusNode?.id ?? null,
      syllabusNodeTitle: mistake.syllabusNode?.title ?? null,
    })),
    dueNotes: dueNotes.map((note) => ({
      id: note.id,
      title: note.title,
      subjectName: note.subject.name,
      dueAt: note.nextReviewAt,
      syllabusNodeId: note.syllabusNode?.id ?? null,
      syllabusNodeTitle: note.syllabusNode?.title ?? null,
    })),
    weakNodes: [...weakNodeMap.values()].map((node) => ({
      id: node.id,
      title: node.title,
      status: fromDbSyllabusNodeStatus(node.status),
      subjectName: node.subject.name,
      mistakeCount: node._count.mistakes,
      noteCount: node._count.notes,
    })),
    now,
  });
  const risks = riskSummary.risks.map(serializeAnalyticsRisk);

  return {
    range: {
      start: start.toISOString(),
      end: today.end.toISOString(),
      days: windowDays,
    },
    totals: {
      todayMinutes: todayPoint.totalMinutes,
      todayEffectiveMinutes: todayPoint.effectiveMinutes,
      weekMinutes,
      weekEffectiveMinutes,
      dailyTaskCompletionRate: todayPoint.taskCompletionRate,
      weeklyTaskCompletionRate,
      streakDays,
      missedDays,
      reviewCompletionRate,
      totalMistakes,
      dueMistakes: dueMistakes.length,
      dueNotes: dueNotes.length,
      weakNodeCount: weakNodeMap.size,
      lowConversionCount,
      activity: daily.reduce((total, point) => {
        const next = point.activity;
        return {
          studyMinutes: total.studyMinutes + next.studyMinutes,
          reviewMinutes: total.reviewMinutes + next.reviewMinutes,
          testMinutes: total.testMinutes + next.testMinutes,
          totalMinutes: total.totalMinutes + next.totalMinutes,
          effectiveStudyMinutes: total.effectiveStudyMinutes + next.effectiveStudyMinutes,
          effectiveReviewMinutes: total.effectiveReviewMinutes + next.effectiveReviewMinutes,
          effectiveTestMinutes: total.effectiveTestMinutes + next.effectiveTestMinutes,
          studySessionCount: total.studySessionCount + next.studySessionCount,
          reviewSessionCount: total.reviewSessionCount + next.reviewSessionCount,
          testSessionCount: total.testSessionCount + next.testSessionCount,
        };
      }, emptyActivityBreakdown()),
    },
    daily,
    subjects: buildSubjectShares(subjects, sessions),
    risks,
    actions: riskSummary.actions,
  };
}

function buildDailySnapshots(
  start: Date,
    sessions: Array<{
      startedAt: Date;
      effectiveMinutes: number;
      isEffective: boolean | null;
      isLowConversion?: boolean | null;
      activityKind?: string | null;
      activityMode?: string | null;
  }>,
  tasks: Array<{
    plannedDate: Date;
    status: DbTaskStatus;
  }>,
  reviews: Array<{
    reviewDate: Date;
  }>,
  checkInSnapshots: Map<string, ReturnType<typeof buildDailyCheckInSnapshot>>,
  days = weekDays,
): ReturnType<typeof buildDailyCheckInSnapshot>[] {
  const reviewKeys = new Set(reviews.map((review) => getStudyDayKey(review.reviewDate)));

  return Array.from({ length: days }, (_, index) => {
    const day = getStudyDayRange(new Date(start.getTime() + index * dayMs));
    const snapshot = checkInSnapshots.get(day.key);
    if (snapshot) {
      return snapshot;
    }

    const daySessions = sessions.filter((session) => session.startedAt >= day.start && session.startedAt < day.end);
    const dayTasks = tasks.filter((task) => task.plannedDate >= day.start && task.plannedDate < day.end);
    return buildDailyCheckInSnapshot({
      studyDate: day.key,
      sessions: daySessions.map((session) => ({
        effectiveMinutes: session.effectiveMinutes,
        isEffective: session.isEffective,
        isLowConversion: session.isLowConversion,
      })),
      tasks: dayTasks.map((task) => ({ status: toCoreTaskStatus(task.status) })),
      reviewSubmitted: reviewKeys.has(day.key),
    });
  });
}

function buildSubjectShares(
  subjects: Array<{
    id: string;
    name: string;
    color: string;
  }>,
  sessions: Array<{
    subjectId: string;
    effectiveMinutes: number;
    isEffective: boolean | null;
    isLowConversion?: boolean | null;
    activityKind?: string | null;
    activityMode?: string | null;
  }>,
): AnalyticsSubjectShareDto[] {
  const totalMinutes = sessions.reduce((total, session) => total + session.effectiveMinutes, 0);

  return subjects.map((subject) => {
    const subjectSessions = sessions.filter((session) => session.subjectId === subject.id);
    const activity = aggregateActivityBreakdown(subjectSessions);
    const subjectMinutes = subjectSessions.reduce((total, session) => total + session.effectiveMinutes, 0);

    return {
      subjectId: subject.id,
      subjectName: subject.name,
      subjectColor: subject.color,
      totalMinutes: subjectMinutes,
      effectiveMinutes: subjectSessions
        .filter((session) => session.isEffective)
        .reduce((total, session) => total + session.effectiveMinutes, 0),
      share: totalMinutes === 0 ? 0 : Math.round((subjectMinutes / totalMinutes) * 100),
      activity,
    };
  });
}

function averageDailyTaskCompletion(snapshots: Array<{ taskCompletionRate: number }>): number {
  if (snapshots.length === 0) return 0;
  return snapshots.reduce((total, snapshot) => total + snapshot.taskCompletionRate, 0) / snapshots.length;
}

function toCoreTaskStatus(status: DbTaskStatus): TaskStatus {
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

function calculateStreak(daily: AnalyticsDailyPointDto[]): number {
  let streak = 0;

  for (let index = daily.length - 1; index >= 0; index -= 1) {
    if (daily[index]?.effectiveMinutes === 0) break;
    streak += 1;
  }

  return streak;
}

export function fromDbSyllabusNodeStatus(status: DbSyllabusNodeStatus): SyllabusNodeStatusDto {
  switch (status) {
    case "NOT_STARTED":
      return "not_started";
    case "LEARNING":
      return "learning";
    case "COVERED":
      return "covered";
    case "NEEDS_REVIEW":
      return "needs_review";
    case "MASTERED":
      return "mastered";
    case "WEAK":
      return "weak";
    case "DEFERRED":
      return "deferred";
  }
}

function serializeAnalyticsRisk(risk: AnalyticsRiskSummaryItem): AnalyticsRiskItemDto {
  return {
    ...risk,
    dueAt: risk.dueAt?.toISOString() ?? null,
  };
}
