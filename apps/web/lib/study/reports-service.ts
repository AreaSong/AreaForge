import { prisma } from "@areaforge/db";
import { getStudyDayRange } from "./date";

const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

export type PeriodicReportKind = "week" | "month";

export interface PeriodicSubjectShareDto {
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  totalMinutes: number;
  effectiveMinutes: number;
  share: number;
  debtCount: number;
  mistakeCount: number;
}

export interface PeriodicReportDto {
  kind: PeriodicReportKind;
  title: string;
  range: {
    start: string;
    end: string;
    days: number;
  };
  metrics: {
    totalMinutes: number;
    effectiveMinutes: number;
    taskCompletionRate: number;
    taskCount: number;
    completedTaskCount: number;
    debtCount: number;
    lowConversionCount: number;
    reviewCompletionRate: number;
    reviewCount: number;
    mistakesCreatedCount: number;
    mistakeReviewUpdateCount: number;
    dueNoteCount: number;
    weakNodeCount: number;
  };
  subjectShares: PeriodicSubjectShareDto[];
  debtPreview: Array<{
    id: string;
    title: string;
    subjectName: string;
    plannedDate: string;
  }>;
  weakness: {
    title: string;
    detail: string;
    subjectName?: string;
    syllabusNodeTitle?: string;
  };
  strategy: {
    mustPressIssue: string;
    nextActions: string[];
    stageAdjustment: string;
    theme: "recovery" | "strengthening" | "sprint" | "steady";
    calmConclusion: string;
  };
  aiDraft: {
    status: "local_rule_fallback";
    title: string;
    content: string;
    reason: string;
  };
}

export interface PeriodicReportsDto {
  week: PeriodicReportDto;
  month: PeriodicReportDto;
}

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type DbSyllabusNodeStatus = "NOT_STARTED" | "LEARNING" | "COVERED" | "NEEDS_REVIEW" | "MASTERED" | "WEAK" | "DEFERRED";

export async function getPeriodicReports(now = new Date()): Promise<PeriodicReportsDto> {
  const [week, month] = await Promise.all([
    getPeriodicReport("week", now),
    getPeriodicReport("month", now),
  ]);

  return { week, month };
}

export async function getPeriodicReport(kind: PeriodicReportKind, now = new Date()): Promise<PeriodicReportDto> {
  const range = kind === "week" ? getWeekRange(now) : getMonthRange(now);
  const [
    subjects,
    sessions,
    tasks,
    reviews,
    mistakes,
    dueNotes,
    debtTasks,
    weakNodes,
  ] = await Promise.all([
    prisma.subject.findMany({
      orderBy: { sortOrder: "asc" },
    }),
    prisma.studySession.findMany({
      where: {
        startedAt: {
          gte: range.start,
          lt: range.end,
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
          gte: range.start,
          lt: range.end,
        },
      },
      include: {
        subject: true,
      },
    }),
    prisma.dailyReview.findMany({
      where: {
        reviewDate: {
          gte: range.start,
          lt: range.end,
        },
      },
    }),
    prisma.mistake.findMany({
      where: {
        OR: [
          {
            createdAt: {
              gte: range.start,
              lt: range.end,
            },
          },
          {
            updatedAt: {
              gte: range.start,
              lt: range.end,
            },
          },
          {
            nextReviewAt: {
              gte: range.start,
              lt: range.end,
            },
          },
        ],
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    }),
    prisma.note.findMany({
      where: {
        nextReviewAt: {
          gte: range.start,
          lt: range.end,
        },
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    }),
    prisma.studyTask.findMany({
      where: {
        plannedDate: {
          lt: range.end,
        },
        status: {
          notIn: ["DONE", "SKIPPED"],
        },
      },
      include: {
        subject: true,
      },
      orderBy: [{ priority: "desc" }, { plannedDate: "asc" }],
      take: 8,
    }),
    prisma.syllabusNode.findMany({
      where: {
        OR: [
          { status: "WEAK" },
          { status: "NEEDS_REVIEW" },
          {
            mistakes: {
              some: {},
            },
          },
        ],
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
      take: 10,
    }),
  ]);

  const totalMinutes = sessions.reduce((total, session) => total + session.effectiveMinutes, 0);
  const effectiveMinutes = sessions
    .filter((session) => session.isEffective)
    .reduce((total, session) => total + session.effectiveMinutes, 0);
  const completedTaskCount = tasks.filter((task) => task.status === "DONE").length;
  const taskCompletionRate = calculateTaskCompletion(tasks);
  const lowConversionCount = sessions.filter((session) => session.isEffective === false).length;
  const mistakesCreatedCount = mistakes.filter((mistake) => isWithin(mistake.createdAt, range.start, range.end)).length;
  const mistakeReviewUpdateCount = mistakes.filter((mistake) => isReviewUpdate(mistake, range.start, range.end)).length;
  const subjectShares = buildSubjectShares(subjects, sessions, debtTasks, mistakes);
  const weakness = chooseWeakness({ subjectShares, debtTasks, weakNodes, lowConversionCount });
  const strategy = createStrategy({
    kind,
    effectiveMinutes,
    taskCompletionRate,
    debtCount: debtTasks.length,
    lowConversionCount,
    mistakesCreatedCount,
    mistakeReviewUpdateCount,
    reviewCompletionRate: reviews.length / range.days,
    weakness,
  });

  return {
    kind,
    title: kind === "week" ? "周审判报告" : "月复盘报告",
    range: {
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      days: range.days,
    },
    metrics: {
      totalMinutes,
      effectiveMinutes,
      taskCompletionRate,
      taskCount: tasks.length,
      completedTaskCount,
      debtCount: debtTasks.length,
      lowConversionCount,
      reviewCompletionRate: reviews.length / range.days,
      reviewCount: reviews.length,
      mistakesCreatedCount,
      mistakeReviewUpdateCount,
      dueNoteCount: dueNotes.length,
      weakNodeCount: weakNodes.length,
    },
    subjectShares,
    debtPreview: debtTasks.map((task) => ({
      id: task.id,
      title: task.title,
      subjectName: task.subject.name,
      plannedDate: task.plannedDate.toISOString(),
    })),
    weakness,
    strategy,
    aiDraft: createLocalReportDraft(strategy),
  };
}

function getWeekRange(now: Date): { start: Date; end: Date; days: number } {
  const today = getStudyDayRange(now);
  return {
    start: new Date(today.start.getTime() - 6 * dayMs),
    end: today.end,
    days: 7,
  };
}

function getMonthRange(now: Date): { start: Date; end: Date; days: number } {
  const today = getStudyDayRange(now);
  const shifted = new Date(today.start.getTime() + shanghaiOffsetMs);
  const start = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - shanghaiOffsetMs);
  const days = Math.max(1, Math.ceil((today.end.getTime() - start.getTime()) / dayMs));

  return {
    start,
    end: today.end,
    days,
  };
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
  debtTasks: Array<{
    subjectId: string;
  }>,
  mistakes: Array<{
    subjectId: string;
    createdAt: Date;
  }>,
): PeriodicSubjectShareDto[] {
  const totalMinutes = sessions.reduce((total, session) => total + session.effectiveMinutes, 0);

  return subjects.map((subject) => {
    const subjectSessions = sessions.filter((session) => session.subjectId === subject.id);
    const subjectTotal = subjectSessions.reduce((total, session) => total + session.effectiveMinutes, 0);

    return {
      subjectId: subject.id,
      subjectName: subject.name,
      subjectColor: subject.color,
      totalMinutes: subjectTotal,
      effectiveMinutes: subjectSessions
        .filter((session) => session.isEffective)
        .reduce((total, session) => total + session.effectiveMinutes, 0),
      share: totalMinutes === 0 ? 0 : Math.round((subjectTotal / totalMinutes) * 100),
      debtCount: debtTasks.filter((task) => task.subjectId === subject.id).length,
      mistakeCount: mistakes.filter((mistake) => mistake.subjectId === subject.id).length,
    };
  });
}

function chooseWeakness(input: {
  subjectShares: PeriodicSubjectShareDto[];
  debtTasks: Array<{
    subject: { name: string };
  }>;
  weakNodes: Array<{
    title: string;
    status: DbSyllabusNodeStatus;
    subject: { name: string };
    _count: {
      mistakes: number;
      notes: number;
      sessions: number;
    };
  }>;
  lowConversionCount: number;
}): PeriodicReportDto["weakness"] {
  const strongestNode = [...input.weakNodes].sort((left, right) => {
    const leftWeight = weaknessWeight(left.status, left._count.mistakes);
    const rightWeight = weaknessWeight(right.status, right._count.mistakes);
    return rightWeight - leftWeight;
  })[0];

  if (strongestNode) {
    return {
      title: strongestNode.status === "WEAK" ? "最大短板：薄弱节点" : "最大短板：错题集中节点",
      detail: `${strongestNode.subject.name} / ${strongestNode.title}：错题 ${strongestNode._count.mistakes}，计时证据 ${strongestNode._count.sessions}，笔记 ${strongestNode._count.notes}。`,
      subjectName: strongestNode.subject.name,
      syllabusNodeTitle: strongestNode.title,
    };
  }

  const debtSubject = mostFrequent(input.debtTasks.map((task) => task.subject.name));
  if (debtSubject) {
    return {
      title: "最大短板：任务欠账集中",
      detail: `${debtSubject} 的欠账最多，下周期先压这个科目。`,
      subjectName: debtSubject,
    };
  }

  const lowShareSubject = input.subjectShares.find((subject) => subject.effectiveMinutes === 0);
  if (lowShareSubject) {
    return {
      title: "最大短板：投入缺口",
      detail: `${lowShareSubject.subjectName} 本周期没有有效学习记录。`,
      subjectName: lowShareSubject.subjectName,
    };
  }

  if (input.lowConversionCount > 0) {
    return {
      title: "最大短板：低转化学习",
      detail: `本周期有 ${input.lowConversionCount} 次学习被标记为低转化。`,
    };
  }

  return {
    title: "最大短板：暂无明确集中风险",
    detail: "当前数据没有显示单一短板，继续保持任务、计时、笔记和错题的关联。",
  };
}

function createStrategy(input: {
  kind: PeriodicReportKind;
  effectiveMinutes: number;
  taskCompletionRate: number;
  debtCount: number;
  lowConversionCount: number;
  mistakesCreatedCount: number;
  mistakeReviewUpdateCount: number;
  reviewCompletionRate: number;
  weakness: PeriodicReportDto["weakness"];
}): PeriodicReportDto["strategy"] {
  const nextActions: string[] = [];
  const minimumMinutes = input.kind === "week" ? 180 : 900;

  if (input.effectiveMinutes < minimumMinutes) {
    nextActions.push(input.kind === "week" ? "下周先保证 3 次有效学习闭环。" : "下月先保证每周至少 3 次有效学习闭环。");
  }

  if (input.taskCompletionRate < 0.5) {
    nextActions.push("把下一周期任务量降到能完成，优先最高优先级任务。");
  }

  if (input.debtCount > 0) {
    nextActions.push("欠账不全补，只挑最影响阶段推进的 1 到 2 项。");
  }

  if (input.lowConversionCount > 0) {
    nextActions.push("每次计时结束必须留下一个可检查产出。");
  }

  if (input.mistakesCreatedCount > input.mistakeReviewUpdateCount) {
    nextActions.push("新增错题必须配套复盘更新，别只收集不会。");
  }

  if (input.reviewCompletionRate < 0.5) {
    nextActions.push("复盘缺口先补，至少写清失控点和下个最小动作。");
  }

  const theme = chooseTheme(input);
  const mustPressIssue = chooseMustPressIssue(input);
  const stageAdjustment = createStageAdjustment(theme, input.kind);

  return {
    mustPressIssue,
    nextActions: nextActions.length > 0 ? [...new Set(nextActions)].slice(0, 5) : ["保持当前节奏，并把产出继续关联到考纲节点。"],
    stageAdjustment,
    theme,
    calmConclusion: createCalmConclusion(theme, mustPressIssue),
  };
}

function createLocalReportDraft(strategy: PeriodicReportDto["strategy"]): PeriodicReportDto["aiDraft"] {
  return {
    status: "local_rule_fallback",
    title: "本地规则复盘草稿",
    content: `${strategy.calmConclusion} 下一周期只压一件事：${strategy.mustPressIssue}`,
    reason: "本次报告没有调用外部 AI，避免默认发送长期学习记录、情绪记录或动机档案。",
  };
}

function chooseTheme(input: {
  effectiveMinutes: number;
  taskCompletionRate: number;
  debtCount: number;
  lowConversionCount: number;
}): PeriodicReportDto["strategy"]["theme"] {
  if (input.effectiveMinutes < 120 || input.taskCompletionRate < 0.3 || input.debtCount >= 8) return "recovery";
  if (input.lowConversionCount >= 3 || input.taskCompletionRate < 0.6) return "strengthening";
  if (input.effectiveMinutes >= 1800 && input.taskCompletionRate >= 0.75) return "sprint";
  return "steady";
}

function chooseMustPressIssue(input: {
  effectiveMinutes: number;
  taskCompletionRate: number;
  debtCount: number;
  lowConversionCount: number;
  mistakesCreatedCount: number;
  mistakeReviewUpdateCount: number;
  weakness: PeriodicReportDto["weakness"];
}): string {
  if (input.effectiveMinutes < 120) return "先恢复有效学习时长，不扩任务。";
  if (input.taskCompletionRate < 0.5) return "先压任务完成率，减少明面任务数量。";
  if (input.debtCount > 0) return "先处理最影响阶段推进的欠账。";
  if (input.lowConversionCount > 0) return "先提高学习转化率，每次必须留产出。";
  if (input.mistakesCreatedCount > input.mistakeReviewUpdateCount) return "先把新增错题变成复盘证据。";
  return input.weakness.detail;
}

function createStageAdjustment(theme: PeriodicReportDto["strategy"]["theme"], kind: PeriodicReportKind): string {
  const target = kind === "week" ? "下周" : "下月";

  switch (theme) {
    case "recovery":
      return `${target} 减少任务量，先恢复有效学习和复盘闭环。`;
    case "strengthening":
      return `${target} 任务不求多，重点压低转化和薄弱节点。`;
    case "sprint":
      return `${target} 可以提高压强：增加真题、错题和模拟复盘比重。`;
    case "steady":
      return `${target} 保持稳态推进：延续当前节奏，同时给最大短板固定时间块。`;
  }
}

function createCalmConclusion(theme: PeriodicReportDto["strategy"]["theme"], mustPressIssue: string): string {
  switch (theme) {
    case "recovery":
      return "这不是总结失败，是把系统拉回可执行状态。";
    case "strengthening":
      return "问题已经出现形状了，接下来不要扩张，先把短板打穿。";
    case "sprint":
      return "节奏已经起来了，接下来要把投入压到真题、错题和复盘上。";
    case "steady":
      return `当前可以稳态推进，但不能无视这个问题：${mustPressIssue}`;
  }
}

function calculateTaskCompletion(tasks: Array<{ status: DbTaskStatus }>): number {
  if (tasks.length === 0) return 0;
  return tasks.filter((task) => task.status === "DONE").length / tasks.length;
}

function weaknessWeight(status: DbSyllabusNodeStatus, mistakeCount: number): number {
  const statusWeight = status === "WEAK" ? 4 : status === "NEEDS_REVIEW" ? 3 : 1;
  return statusWeight + mistakeCount;
}

function mostFrequent(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function isWithin(value: Date, start: Date, end: Date): boolean {
  return value >= start && value < end;
}

function isReviewUpdate(
  mistake: {
    createdAt: Date;
    updatedAt: Date;
  },
  start: Date,
  end: Date,
): boolean {
  return isWithin(mistake.updatedAt, start, end) && mistake.updatedAt.getTime() - mistake.createdAt.getTime() > 1000;
}
