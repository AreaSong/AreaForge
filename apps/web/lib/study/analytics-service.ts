import {
  buildDailyCheckInSnapshot,
  summarizeAnalyticsRisks,
  type AnalyticsRiskSummaryItem,
  type TaskStatus,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { cache } from "react";
import { listCheckInSnapshotsInRange } from "./check-in-service";
import { getStudyDayKey, getStudyDayRange } from "./date";
import type { SyllabusNodeStatusDto } from "./types";

const dayMs = 24 * 60 * 60 * 1000;
const weekDays = 7;

export interface AnalyticsDailyPointDto {
  dayKey: string;
  totalMinutes: number;
  effectiveMinutes: number;
  taskCompletionRate: number;
  reviewSubmitted: boolean;
}

export interface AnalyticsSubjectShareDto {
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  totalMinutes: number;
  effectiveMinutes: number;
  share: number;
}

export interface AnalyticsRiskItemDto {
  id: string;
  type: "weak_node" | "note_review" | "mistake_review" | "review_gap" | "low_completion" | "low_effective";
  severity: "info" | "warning" | "danger";
  title: string;
  detail: string;
  action: string;
  subjectName?: string;
  syllabusNodeId?: string | null;
  syllabusNodeTitle?: string | null;
  dueAt?: string | null;
}

export interface AnalyticsSummaryDto {
  range: {
    start: string;
    end: string;
    days: number;
  };
  totals: {
    todayMinutes: number;
    todayEffectiveMinutes: number;
    weekMinutes: number;
    weekEffectiveMinutes: number;
    dailyTaskCompletionRate: number;
    weeklyTaskCompletionRate: number;
    streakDays: number;
    missedDays: number;
    reviewCompletionRate: number;
    totalMistakes: number;
    dueMistakes: number;
    dueNotes: number;
    weakNodeCount: number;
    lowConversionCount: number;
  };
  daily: AnalyticsDailyPointDto[];
  subjects: AnalyticsSubjectShareDto[];
  risks: AnalyticsRiskItemDto[];
  actions: string[];
}

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type DbSyllabusNodeStatus = "NOT_STARTED" | "LEARNING" | "COVERED" | "NEEDS_REVIEW" | "MASTERED" | "WEAK" | "DEFERRED";

// 同一次服务端渲染内的只读共享副本，供 AI 建议与长期风险等多个消费方复用同一份统计结果。
export const getAnalyticsSummaryShared = cache(async (): Promise<AnalyticsSummaryDto> => getAnalyticsSummary());

export async function getAnalyticsSummary(now = new Date()): Promise<AnalyticsSummaryDto> {
  const today = getStudyDayRange(now);
  const start = new Date(today.start.getTime() - (weekDays - 1) * dayMs);
  const reviewLookaheadEnd = new Date(today.end.getTime() + 3 * dayMs);

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
      orderBy: { sortOrder: "asc" },
    }),
    prisma.studySession.findMany({
      where: {
        startedAt: {
          gte: start,
          lt: today.end,
        },
        status: "COMPLETED",
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
      },
      orderBy: { reviewDate: "asc" },
    }),
    prisma.mistake.count(),
    prisma.mistake.findMany({
      where: {
        nextReviewAt: {
          lte: reviewLookaheadEnd,
        },
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
    listCheckInSnapshotsInRange(start, today.end),
  ]);

  const dailySnapshots = buildDailySnapshots(start, sessions, tasks, reviews, checkInSnapshots);
  const daily = dailySnapshots.map((snapshot) => ({
    dayKey: snapshot.studyDate,
    totalMinutes: snapshot.totalMinutes,
    effectiveMinutes: snapshot.effectiveMinutes,
    taskCompletionRate: snapshot.taskCompletionRate,
    reviewSubmitted: snapshot.reviewSubmitted,
  }));
  const todayPoint = daily[daily.length - 1] ?? {
    totalMinutes: 0,
    effectiveMinutes: 0,
    taskCompletionRate: 0,
  };
  const weekMinutes = daily.reduce((total, point) => total + point.totalMinutes, 0);
  const weekEffectiveMinutes = daily.reduce((total, point) => total + point.effectiveMinutes, 0);
  const weeklyTaskCompletionRate = averageDailyTaskCompletion(dailySnapshots);
  const reviewCompletionRate = dailySnapshots.filter((snapshot) => snapshot.reviewSubmitted).length / weekDays;
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
      days: weekDays,
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
  }>,
  tasks: Array<{
    plannedDate: Date;
    status: DbTaskStatus;
  }>,
  reviews: Array<{
    reviewDate: Date;
  }>,
  checkInSnapshots: Map<string, ReturnType<typeof buildDailyCheckInSnapshot>>,
): ReturnType<typeof buildDailyCheckInSnapshot>[] {
  const reviewKeys = new Set(reviews.map((review) => getStudyDayKey(review.reviewDate)));

  return Array.from({ length: weekDays }, (_, index) => {
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
  }>,
): AnalyticsSubjectShareDto[] {
  const totalMinutes = sessions.reduce((total, session) => total + session.effectiveMinutes, 0);

  return subjects.map((subject) => {
    const subjectSessions = sessions.filter((session) => session.subjectId === subject.id);
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
