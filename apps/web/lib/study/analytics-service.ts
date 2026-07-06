import { prisma } from "@areaforge/db";
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
  ]);

  const daily = buildDailyPoints(start, sessions, tasks, reviews);
  const todayPoint = daily[daily.length - 1] ?? {
    totalMinutes: 0,
    effectiveMinutes: 0,
    taskCompletionRate: 0,
  };
  const weekMinutes = daily.reduce((total, point) => total + point.totalMinutes, 0);
  const weekEffectiveMinutes = daily.reduce((total, point) => total + point.effectiveMinutes, 0);
  const weeklyTaskCompletionRate = calculateTaskCompletion(tasks);
  const reviewCompletionRate = reviews.length / weekDays;
  const streakDays = calculateStreak(daily);
  const missedDays = daily.filter((point) => point.effectiveMinutes === 0).length;
  const lowConversionCount = sessions.filter((session) => session.isEffective === false).length;
  const weakNodeMap = new Map(weakNodes.map((node) => [node.id, node]));

  for (const node of reviewRiskNodes) {
    if (node._count.mistakes >= 2 && !weakNodeMap.has(node.id)) {
      weakNodeMap.set(node.id, node);
    }
  }

  const risks = buildRiskItems({
    daily,
    dueMistakes,
    dueNotes,
    weakNodes: [...weakNodeMap.values()],
    weeklyTaskCompletionRate,
    weekEffectiveMinutes,
    reviewCompletionRate,
  });
  const actions = buildActions({
    weekEffectiveMinutes,
    weeklyTaskCompletionRate,
    reviewCompletionRate,
    risks,
  });

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
    actions,
  };
}

function buildDailyPoints(
  start: Date,
  sessions: Array<{
    startedAt: Date;
    effectiveMinutes: number;
    isEffective: boolean | null;
  }>,
  tasks: Array<{
    plannedDate: Date;
    status: DbTaskStatus;
  }>,
  reviews: Array<{
    reviewDate: Date;
  }>,
): AnalyticsDailyPointDto[] {
  const reviewKeys = new Set(reviews.map((review) => getStudyDayKey(review.reviewDate)));

  return Array.from({ length: weekDays }, (_, index) => {
    const day = getStudyDayRange(new Date(start.getTime() + index * dayMs));
    const daySessions = sessions.filter((session) => session.startedAt >= day.start && session.startedAt < day.end);
    const dayTasks = tasks.filter((task) => task.plannedDate >= day.start && task.plannedDate < day.end);

    return {
      dayKey: day.key,
      totalMinutes: daySessions.reduce((total, session) => total + session.effectiveMinutes, 0),
      effectiveMinutes: daySessions
        .filter((session) => session.isEffective)
        .reduce((total, session) => total + session.effectiveMinutes, 0),
      taskCompletionRate: calculateTaskCompletion(dayTasks),
      reviewSubmitted: reviewKeys.has(day.key),
    };
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

function buildRiskItems(input: {
  daily: AnalyticsDailyPointDto[];
  dueMistakes: Array<{
    id: string;
    title: string;
    nextReviewAt: Date | null;
    subject: { name: string };
    syllabusNode?: { id: string; title: string } | null;
  }>;
  dueNotes: Array<{
    id: string;
    title: string;
    nextReviewAt: Date | null;
    subject: { name: string };
    syllabusNode?: { id: string; title: string } | null;
  }>;
  weakNodes: Array<{
    id: string;
    title: string;
    status: DbSyllabusNodeStatus;
    subject: { name: string };
    _count: {
      tasks: number;
      sessions: number;
      notes: number;
      mistakes: number;
    };
  }>;
  weeklyTaskCompletionRate: number;
  weekEffectiveMinutes: number;
  reviewCompletionRate: number;
}): AnalyticsRiskItemDto[] {
  const risks: AnalyticsRiskItemDto[] = [];

  if (input.weekEffectiveMinutes < 120) {
    risks.push({
      id: "low-effective-week",
      type: "low_effective",
      severity: "danger",
      title: "本周有效学习不足",
      detail: `近 7 天只有 ${input.weekEffectiveMinutes} 分钟有效学习。`,
      action: "先完成一次 30 到 90 分钟的有效学习，再扩展任务量。",
    });
  }

  if (input.weeklyTaskCompletionRate < 0.4) {
    risks.push({
      id: "low-task-completion",
      type: "low_completion",
      severity: "warning",
      title: "任务完成率偏低",
      detail: `近 7 天任务完成率为 ${formatPercent(input.weeklyTaskCompletionRate)}。`,
      action: "减少明天任务数量，把最关键的一项压到完成。",
    });
  }

  if (input.reviewCompletionRate < 0.5) {
    risks.push({
      id: "review-gap",
      type: "review_gap",
      severity: "warning",
      title: "复盘覆盖不足",
      detail: `近 7 天复盘完成率为 ${formatPercent(input.reviewCompletionRate)}。`,
      action: "今晚先补一条复盘，把明天最小任务写下来。",
    });
  }

  for (const node of input.weakNodes) {
    risks.push({
      id: `weak-node-${node.id}`,
      type: "weak_node",
      severity: node.status === "WEAK" || node._count.mistakes >= 2 ? "danger" : "warning",
      title: node.status === "WEAK" ? "薄弱节点" : "错题集中节点",
      detail: `${node.subject.name} / ${node.title}：错题 ${node._count.mistakes}，笔记 ${node._count.notes}。`,
      action: "从这个节点挑一道错题复盘，并补一条可解释笔记。",
      subjectName: node.subject.name,
      syllabusNodeId: node.id,
      syllabusNodeTitle: node.title,
    });
  }

  for (const mistake of input.dueMistakes) {
    risks.push({
      id: `mistake-${mistake.id}`,
      type: "mistake_review",
      severity: isOverdue(mistake.nextReviewAt) ? "danger" : "warning",
      title: "错题复习到期",
      detail: `${mistake.subject.name} / ${mistake.title}`,
      action: "今天复做这道错题，更新正确思路和下次复习时间。",
      subjectName: mistake.subject.name,
      syllabusNodeId: mistake.syllabusNode?.id ?? null,
      syllabusNodeTitle: mistake.syllabusNode?.title ?? null,
      dueAt: mistake.nextReviewAt?.toISOString() ?? null,
    });
  }

  for (const note of input.dueNotes) {
    risks.push({
      id: `note-${note.id}`,
      type: "note_review",
      severity: isOverdue(note.nextReviewAt) ? "danger" : "info",
      title: "笔记复习提醒",
      detail: `${note.subject.name} / ${note.title}`,
      action: "回看这条笔记，用自己的话复述一遍核心结论。",
      subjectName: note.subject.name,
      syllabusNodeId: note.syllabusNode?.id ?? null,
      syllabusNodeTitle: note.syllabusNode?.title ?? null,
      dueAt: note.nextReviewAt?.toISOString() ?? null,
    });
  }

  return risks.slice(0, 12);
}

function buildActions(input: {
  weekEffectiveMinutes: number;
  weeklyTaskCompletionRate: number;
  reviewCompletionRate: number;
  risks: AnalyticsRiskItemDto[];
}): string[] {
  const actions: string[] = [];
  const firstReviewRisk = input.risks.find((risk) => risk.type === "mistake_review" || risk.type === "note_review");
  const firstWeakNode = input.risks.find((risk) => risk.type === "weak_node");

  if (input.weekEffectiveMinutes < 120) {
    actions.push("今天只追求一次有效学习闭环，不补过去的总账。");
  }

  if (input.weeklyTaskCompletionRate < 0.4) {
    actions.push("明天任务缩到 1 到 2 项，优先完成最高优先级任务。");
  }

  if (input.reviewCompletionRate < 0.5) {
    actions.push("今晚提交复盘，至少写清失控点和明天最小动作。");
  }

  if (firstReviewRisk) {
    actions.push(firstReviewRisk.action);
  }

  if (firstWeakNode) {
    actions.push(firstWeakNode.action);
  }

  return actions.length > 0 ? [...new Set(actions)].slice(0, 5) : ["继续保持当前节奏，把新增产出关联到任务或考纲节点。"];
}

function calculateTaskCompletion(tasks: Array<{ status: DbTaskStatus }>): number {
  if (tasks.length === 0) return 0;
  return tasks.filter((task) => task.status === "DONE").length / tasks.length;
}

function calculateStreak(daily: AnalyticsDailyPointDto[]): number {
  let streak = 0;

  for (let index = daily.length - 1; index >= 0; index -= 1) {
    if (daily[index]?.effectiveMinutes === 0) break;
    streak += 1;
  }

  return streak;
}

function isOverdue(value: Date | null): boolean {
  return Boolean(value && value.getTime() < Date.now());
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

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
