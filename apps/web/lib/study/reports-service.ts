import {
  buildDailyCheckInSnapshot,
  choosePeriodicWeakness,
  createPeriodicNextCycleDraft,
  createPeriodicReportDecisionSnapshot,
  summarizePeriodicReportStrategy,
  type CheckInSnapshotSummary,
  type PeriodicWeaknessNodeStatus,
  type TaskStatus,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { listCheckInSnapshotsInRange } from "./check-in-service";
import { getStudyDayRange } from "./date";
import { listStageAdjustmentDrafts, listStagePlans } from "./stage-service";
import type { StageAdjustmentDraftRecordDto, StagePlanDto } from "./types";

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

type PeriodicNextCycleDraftDto = ReturnType<typeof createPeriodicNextCycleDraft>;
type PeriodicDecisionSnapshotDto = ReturnType<typeof createPeriodicReportDecisionSnapshot>;

export interface PeriodicReportDecisionDto {
  id: string;
  kind: PeriodicReportKind;
  range: {
    start: string;
    end: string;
  };
  status: "confirmed" | "rejected";
  reportSnapshot: PeriodicDecisionSnapshotDto;
  nextCycleDraft: PeriodicNextCycleDraftDto | null;
  canAutoApply: false;
  requiresUserConfirmation: true;
  decidedAt: string;
  actorId: string | null;
  alreadyDecided?: boolean;
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
    source: "syllabus_node" | "debt_subject" | "zero_effective_subject" | "low_conversion" | "none";
    severity: "critical" | "high" | "medium" | "low" | "clear";
    reasons: string[];
    subjectName?: string;
    syllabusNodeTitle?: string;
  };
  strategy: {
    mustPressIssue: string;
    nextActions: string[];
    stageAdjustment: string;
    theme: "recovery" | "strengthening" | "sprint" | "steady";
    calmConclusion: string;
    canAutoApply: false;
    requiresUserConfirmation: true;
  };
  aiDraft: {
    status: "local_rule_fallback";
    title: string;
    content: string;
    reason: string;
    canAutoApply: false;
    requiresUserConfirmation: true;
  };
  stagePersistence: {
    planApiPath: "/api/simulation/stage-plans";
    draftApiPath: "/api/simulation/stage-adjustment-drafts";
    latestPlan: StagePlanDto | null;
    latestDraft: StageAdjustmentDraftRecordDto | null;
    canAutoApply: false;
    requiresUserConfirmation: true;
  };
  decisionPreview: {
    status: "read_only_preview";
    snapshot: PeriodicDecisionSnapshotDto;
    nextCycleDraft: PeriodicNextCycleDraftDto;
    canAutoApply: false;
    requiresUserConfirmation: true;
  };
  decision: PeriodicReportDecisionDto | null;
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
    dueNoteCount,
    debtTasks,
    weakNodes,
    checkInSnapshots,
    stagePlans,
    stageAdjustmentDrafts,
    existingDecision,
  ] = await Promise.all([
    prisma.subject.findMany({
      orderBy: { sortOrder: "asc" },
    }),
    // 报表只做区间聚合，按实际消费字段 select，不携带 subject/syllabusNode 关联行。
    prisma.studySession.findMany({
      where: {
        startedAt: {
          gte: range.start,
          lt: range.end,
        },
        status: "COMPLETED",
      },
      select: {
        subjectId: true,
        startedAt: true,
        effectiveMinutes: true,
        isEffective: true,
        isLowConversion: true,
      },
    }),
    prisma.studyTask.findMany({
      where: {
        plannedDate: {
          gte: range.start,
          lt: range.end,
        },
      },
      select: {
        plannedDate: true,
        status: true,
      },
    }),
    prisma.dailyReview.findMany({
      where: {
        reviewDate: {
          gte: range.start,
          lt: range.end,
        },
      },
      select: {
        reviewDate: true,
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
      select: {
        subjectId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.note.count({
      where: {
        nextReviewAt: {
          gte: range.start,
          lt: range.end,
        },
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
    listCheckInSnapshotsInRange(range.start, range.end),
    listStagePlans(),
    listStageAdjustmentDrafts(),
    prisma.periodicReportDecision.findUnique({
      where: {
        kind_rangeStart_rangeEnd: {
          kind,
          rangeStart: range.start,
          rangeEnd: range.end,
        },
      },
    }),
  ]);

  const dailySnapshots = buildPeriodicDailySnapshots(range, sessions, tasks, reviews, checkInSnapshots);
  const totalMinutes = dailySnapshots.reduce((total, snapshot) => total + snapshot.totalMinutes, 0);
  const effectiveMinutes = dailySnapshots.reduce((total, snapshot) => total + snapshot.effectiveMinutes, 0);
  const completedTaskCount = tasks.filter((task) => task.status === "DONE").length;
  const taskCompletionRate = averageDailyTaskCompletion(dailySnapshots);
  const lowConversionCount = dailySnapshots.reduce((total, snapshot) => total + snapshot.lowConversionCount, 0);
  const reviewCompletionRate = dailySnapshots.filter((snapshot) => snapshot.reviewSubmitted).length / range.days;
  const mistakesCreatedCount = mistakes.filter((mistake) => isWithin(mistake.createdAt, range.start, range.end)).length;
  const mistakeReviewUpdateCount = mistakes.filter((mistake) => isReviewUpdate(mistake, range.start, range.end)).length;
  const subjectShares = buildSubjectShares(subjects, sessions, debtTasks, mistakes);
  const weakness = choosePeriodicWeakness({
    subjectShares: subjectShares.map((subject) => ({
      subjectName: subject.subjectName,
      effectiveMinutes: subject.effectiveMinutes,
    })),
    debtTasks: debtTasks.map((task) => ({
      subjectName: task.subject.name,
    })),
    weakNodes: weakNodes.map((node) => ({
      title: node.title,
      status: toCoreWeaknessNodeStatus(node.status),
      subjectName: node.subject.name,
      mistakeCount: node._count.mistakes,
      noteCount: node._count.notes,
      sessionCount: node._count.sessions,
    })),
    lowConversionCount,
  });
  const strategy = createStrategy({
    kind,
    effectiveMinutes,
    taskCompletionRate,
    debtCount: debtTasks.length,
    lowConversionCount,
    mistakesCreatedCount,
    mistakeReviewUpdateCount,
    reviewCompletionRate,
    weakNodeCount: weakNodes.length,
    dueNoteCount,
    weakness,
  });
  const rangeDto = {
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    days: range.days,
  };
  const metrics = {
    totalMinutes,
    effectiveMinutes,
    taskCompletionRate,
    taskCount: tasks.length,
    completedTaskCount,
    debtCount: debtTasks.length,
    lowConversionCount,
    reviewCompletionRate,
    reviewCount: reviews.length,
    mistakesCreatedCount,
    mistakeReviewUpdateCount,
    dueNoteCount,
    weakNodeCount: weakNodes.length,
  };
  const nextCycleDraft = createPeriodicNextCycleDraft({
    kind,
    strategy,
    weakness,
  });
  const decisionPreview = {
    status: "read_only_preview" as const,
    snapshot: createPeriodicReportDecisionSnapshot({
      kind,
      range: rangeDto,
      metrics: {
        totalMinutes: metrics.totalMinutes,
        effectiveMinutes: metrics.effectiveMinutes,
        taskCompletionRate: metrics.taskCompletionRate,
        debtCount: metrics.debtCount,
        lowConversionCount: metrics.lowConversionCount,
        reviewCompletionRate: metrics.reviewCompletionRate,
        weakNodeCount: metrics.weakNodeCount,
        dueNoteCount: metrics.dueNoteCount,
        mistakesCreatedCount: metrics.mistakesCreatedCount,
        mistakeReviewCount: metrics.mistakeReviewUpdateCount,
      },
      weakness,
      strategy,
      nextCycleDraft,
    }),
    nextCycleDraft,
    canAutoApply: false as const,
    requiresUserConfirmation: true as const,
  };

  return {
    kind,
    title: kind === "week" ? "周审判报告" : "月复盘报告",
    range: rangeDto,
    metrics,
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
    stagePersistence: {
      planApiPath: "/api/simulation/stage-plans",
      draftApiPath: "/api/simulation/stage-adjustment-drafts",
      latestPlan: stagePlans[0] ?? null,
      latestDraft: stageAdjustmentDrafts[0] ?? null,
      canAutoApply: false,
      requiresUserConfirmation: true,
    },
    decisionPreview,
    decision: existingDecision ? serializePeriodicReportDecision(existingDecision) : null,
  };
}

export function serializePeriodicReportDecision(decision: {
  id: string;
  kind: string;
  rangeStart: Date;
  rangeEnd: Date;
  status: string;
  reportSnapshot: unknown;
  nextCycleDraft: unknown;
  canAutoApply: boolean;
  requiresUserConfirmation: boolean;
  decidedAt: Date;
  actorId: string | null;
}): PeriodicReportDecisionDto {
  return {
    id: decision.id,
    kind: decision.kind === "month" ? "month" : "week",
    range: {
      start: decision.rangeStart.toISOString(),
      end: decision.rangeEnd.toISOString(),
    },
    status: decision.status === "rejected" ? "rejected" : "confirmed",
    reportSnapshot: decision.reportSnapshot as PeriodicDecisionSnapshotDto,
    nextCycleDraft: decision.nextCycleDraft ? decision.nextCycleDraft as PeriodicNextCycleDraftDto : null,
    canAutoApply: false,
    requiresUserConfirmation: true,
    decidedAt: decision.decidedAt.toISOString(),
    actorId: decision.actorId,
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

function buildPeriodicDailySnapshots(
  range: { start: Date; days: number },
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
  checkInSnapshots: Map<string, CheckInSnapshotSummary>,
): CheckInSnapshotSummary[] {
  const reviewKeys = new Set(reviews.map((review) => getStudyDayRange(review.reviewDate).key));

  return Array.from({ length: range.days }, (_, index) => {
    const day = getStudyDayRange(new Date(range.start.getTime() + index * dayMs));
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

function createStrategy(input: {
  kind: PeriodicReportKind;
  effectiveMinutes: number;
  taskCompletionRate: number;
  debtCount: number;
  lowConversionCount: number;
  mistakesCreatedCount: number;
  mistakeReviewUpdateCount: number;
  reviewCompletionRate: number;
  weakNodeCount: number;
  dueNoteCount: number;
  weakness: PeriodicReportDto["weakness"];
}): PeriodicReportDto["strategy"] {
  const strategy = summarizePeriodicReportStrategy({
    kind: input.kind,
    effectiveMinutes: input.effectiveMinutes,
    taskCompletionRate: input.taskCompletionRate,
    debtCount: input.debtCount,
    lowConversionCount: input.lowConversionCount,
    mistakesCreatedCount: input.mistakesCreatedCount,
    mistakeReviewCount: input.mistakeReviewUpdateCount,
    reviewCompletionRate: input.reviewCompletionRate,
    weakNodeCount: input.weakNodeCount,
    dueNoteCount: input.dueNoteCount,
    maxWeakness: input.weakness.detail,
  });

  return {
    mustPressIssue: strategy.mustPressIssue,
    nextActions: strategy.nextActions,
    stageAdjustment: strategy.stageAdjustment,
    theme: strategy.theme,
    calmConclusion: strategy.calmConclusion,
    canAutoApply: strategy.canAutoApply,
    requiresUserConfirmation: strategy.requiresUserConfirmation,
  };
}

function createLocalReportDraft(strategy: PeriodicReportDto["strategy"]): PeriodicReportDto["aiDraft"] {
  return {
    status: "local_rule_fallback",
    title: "本地规则复盘草稿",
    content: `${strategy.calmConclusion} 下一周期只压一件事：${strategy.mustPressIssue}`,
    reason: "本次报告没有调用外部 AI，避免默认发送长期学习记录、情绪记录或动机档案。",
    canAutoApply: false,
    requiresUserConfirmation: true,
  };
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

function toCoreWeaknessNodeStatus(status: DbSyllabusNodeStatus): PeriodicWeaknessNodeStatus {
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
