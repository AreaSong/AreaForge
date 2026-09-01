import type {
  KnowledgeRetestListItemDto,
  KnowledgeRetestResultDto,
  KnowledgeRetestStatusDto,
} from "@/lib/contracts/knowledge-retest";
import type {
  SimulationExamDto,
  SimulationLossReasonDto,
} from "@/lib/contracts/simulation";

// ============================================================================
// 1. Loss Reason Metadata & Color Schemes
// ============================================================================

export interface LossReasonMeta {
  code: SimulationLossReasonDto;
  label: string;
  shortLabel: string;
  color: string;
  tone: "teal" | "emerald" | "amber" | "rose" | "zinc" | "sky" | "purple";
}

export const LOSS_REASON_META_MAP: Record<SimulationLossReasonDto, LossReasonMeta> = {
  CONCEPT_GAP: {
    code: "CONCEPT_GAP",
    label: "概念理解漏洞与知识盲区",
    shortLabel: "概念漏洞",
    color: "#f43f5e",
    tone: "rose",
  },
  CALCULATION_CARELESS: {
    code: "CALCULATION_CARELESS",
    label: "计算粗心失误与笔误丢分",
    shortLabel: "计算失误",
    color: "#f59e0b",
    tone: "amber",
  },
  TIME_ALLOCATION: {
    code: "TIME_ALLOCATION",
    label: "时间分配失控与未及作答",
    shortLabel: "时间失控",
    color: "#38bdf8",
    tone: "sky",
  },
  READING_COMPREHENSION: {
    code: "READING_COMPREHENSION",
    label: "审题不清与题意理解偏差",
    shortLabel: "审题偏差",
    color: "#a855f7",
    tone: "purple",
  },
  UNFAMILIAR_PATTERN: {
    code: "UNFAMILIAR_PATTERN",
    label: "题型模式陌生与变形未见",
    shortLabel: "题型陌生",
    color: "#818cf8",
    tone: "purple",
  },
  MEMORY_FORMULA: {
    code: "MEMORY_FORMULA",
    label: "公式定理遗忘与记忆模糊",
    shortLabel: "公式遗忘",
    color: "#2dd4bf",
    tone: "teal",
  },
  METHOD_ERROR: {
    code: "METHOD_ERROR",
    label: "解题方法错误与思路走偏",
    shortLabel: "方法错误",
    color: "#34d399",
    tone: "emerald",
  },
  MINDSET: {
    code: "MINDSET",
    label: "考场心态不稳与焦虑紧张",
    shortLabel: "心态波动",
    color: "#ec4899",
    tone: "rose",
  },
  UNANSWERED: {
    code: "UNANSWERED",
    label: "空白未作答与战略放弃",
    shortLabel: "空白放弃",
    color: "#71717a",
    tone: "zinc",
  },
  OTHER: {
    code: "OTHER",
    label: "其他综合非归类失分",
    shortLabel: "其他失分",
    color: "#a1a1aa",
    tone: "zinc",
  },
};

export function getLossReasonMeta(reason: string | SimulationLossReasonDto): LossReasonMeta {
  if (reason in LOSS_REASON_META_MAP) {
    return LOSS_REASON_META_MAP[reason as SimulationLossReasonDto];
  }
  return LOSS_REASON_META_MAP.OTHER;
}

// ============================================================================
// 2. High-Density KPI Aggregation
// ============================================================================

export interface TestKpis {
  totalSimulations: number;
  confirmedSimulationsCount: number;
  draftSimulationsCount: number;
  totalRetests: number;
  openRetestsCount: number;
  closedRetestsCount: number;
  retestPassRate: number | null; // 0..100 (%)
  avgActualScore: number | null;
  avgTargetScore: number | null;
  avgScoreDelta: number | null;
  cumulativeLostScore: number;
  pendingTotalLoad: number;
  scoreTrajectory: number[];
}

export function calculateTestKpis(
  retests: KnowledgeRetestListItemDto[],
  simulations: SimulationExamDto[],
): TestKpis {
  const confirmedExams = simulations.filter((s) => s.status === "CONFIRMED");
  const draftExams = simulations.filter((s) => s.status === "DRAFT" || s.status === "IN_PROGRESS");
  const openRetests = retests.filter((r) => r.status !== "CLOSED" && r.status !== "VOIDED");
  const closedRetests = retests.filter((r) => r.status === "CLOSED");
  const passedRetests = closedRetests.filter((r) => r.result === "PASSED");

  const retestPassRate =
    closedRetests.length > 0
      ? Math.round((passedRetests.length / closedRetests.length) * 1000) / 10
      : null;

  // Compute average scores from confirmed exams with actualScore
  const scoredConfirmed = confirmedExams.filter((e) => typeof e.actualScore === "number");
  let avgActualScore: number | null = null;
  let avgTargetScore: number | null = null;
  let avgScoreDelta: number | null = null;

  if (scoredConfirmed.length > 0) {
    const totalActual = scoredConfirmed.reduce((sum, e) => sum + (e.actualScore ?? 0), 0);
    avgActualScore = Math.round((totalActual / scoredConfirmed.length) * 10) / 10;

    const targeted = scoredConfirmed.filter((e) => typeof e.targetScore === "number");
    if (targeted.length > 0) {
      const totalTarget = targeted.reduce((sum, e) => sum + (e.targetScore ?? 0), 0);
      avgTargetScore = Math.round((totalTarget / targeted.length) * 10) / 10;
      avgScoreDelta = Math.round((avgActualScore - avgTargetScore) * 10) / 10;
    }
  }

  // Cumulative lost score from confirmed exams
  let cumulativeLostScore = 0;
  for (const exam of confirmedExams) {
    for (const sub of exam.subjectResults) {
      const full = sub.paperFullScore ?? 0;
      const act = sub.actualScore ?? 0;
      if (full > 0 && act >= 0) {
        cumulativeLostScore += Math.max(0, full - act);
      } else {
        for (const item of sub.lossItems) {
          if (!item.archivedAt) {
            cumulativeLostScore += item.lostScore;
          }
        }
      }
    }
  }
  cumulativeLostScore = Math.round(cumulativeLostScore * 10) / 10;

  // Chronological score trajectory for sparklines
  const sortedScored = [...scoredConfirmed].sort(
    (a, b) => new Date(a.examDate).getTime() - new Date(b.examDate).getTime(),
  );
  const scoreTrajectory = sortedScored.map((e) => e.actualScore ?? 0);

  return {
    totalSimulations: simulations.length,
    confirmedSimulationsCount: confirmedExams.length,
    draftSimulationsCount: draftExams.length,
    totalRetests: retests.length,
    openRetestsCount: openRetests.length,
    closedRetestsCount: closedRetests.length,
    retestPassRate,
    avgActualScore,
    avgTargetScore,
    avgScoreDelta,
    cumulativeLostScore,
    pendingTotalLoad: openRetests.length + draftExams.length,
    scoreTrajectory,
  };
}

// ============================================================================
// 3. Historical Mock Exam Score Trend Data
// ============================================================================

export interface MockExamTrendPoint {
  id: string;
  name: string;
  examDate: string;
  actualScore: number;
  targetScore: number;
  fullScore: number;
  delta: number;
  isAboveTarget: boolean;
  subjectScores: Array<{
    subjectName: string;
    subjectColor: string;
    actualScore: number;
    targetScore: number;
    paperFullScore: number;
  }>;
}

export interface MockExamTrendSummary {
  points: MockExamTrendPoint[];
  maxScore: number;
  minScore: number;
  latestDelta: number | null;
  avgDelta: number | null;
  targetPassRate: number | null;
}

export function calculateMockExamTrends(simulations: SimulationExamDto[]): MockExamTrendSummary {
  const confirmed = simulations.filter((e) => e.status === "CONFIRMED" && typeof e.actualScore === "number");
  const sorted = [...confirmed].sort(
    (a, b) => new Date(a.examDate).getTime() - new Date(b.examDate).getTime(),
  );

  const points: MockExamTrendPoint[] = sorted.map((exam) => {
    const actualScore = exam.actualScore ?? 0;
    const targetScore = exam.targetScore ?? 0;
    const fullScore =
      exam.subjectResults.reduce((sum, s) => sum + (s.paperFullScore ?? 0), 0) ||
      (targetScore > 0 ? Math.round(targetScore * 1.3) : 500);
    const delta = Math.round((actualScore - targetScore) * 10) / 10;

    const subjectScores = exam.subjectResults.map((sub) => ({
      subjectName: sub.subjectName,
      subjectColor: sub.subjectColor || "#2dd4bf",
      actualScore: sub.actualScore ?? 0,
      targetScore: sub.targetScore ?? 0,
      paperFullScore: sub.paperFullScore ?? 100,
    }));

    return {
      id: exam.id,
      name: exam.name,
      examDate: exam.examDate,
      actualScore,
      targetScore,
      fullScore,
      delta,
      isAboveTarget: delta >= 0,
      subjectScores,
    };
  });

  if (points.length === 0) {
    return {
      points: [],
      maxScore: 500,
      minScore: 0,
      latestDelta: null,
      avgDelta: null,
      targetPassRate: null,
    };
  }

  const allActuals = points.map((p) => p.actualScore);
  const allTargets = points.map((p) => p.targetScore);
  const allFulls = points.map((p) => p.fullScore);

  const maxScore = Math.max(...allActuals, ...allTargets, ...allFulls);
  const minScore = Math.min(0, ...allActuals, ...allTargets);

  const latest = points[points.length - 1];
  const latestDelta = latest ? latest.delta : null;

  const totalDelta = points.reduce((sum, p) => sum + p.delta, 0);
  const avgDelta = Math.round((totalDelta / points.length) * 10) / 10;

  const passedCount = points.filter((p) => p.isAboveTarget).length;
  const targetPassRate = Math.round((passedCount / points.length) * 1000) / 10;

  return {
    points,
    maxScore,
    minScore,
    latestDelta,
    avgDelta,
    targetPassRate,
  };
}

// ============================================================================
// 4. Loss Reason Distribution & Breakdown
// ============================================================================

export interface LossReasonDistributionItem {
  reason: SimulationLossReasonDto;
  meta: LossReasonMeta;
  totalLostScore: number;
  itemCount: number;
  percentage: number;
}

export interface LossReasonDistributionSummary {
  items: LossReasonDistributionItem[];
  totalLostScore: number;
  totalLossItemsCount: number;
}

export function calculateLossReasonDistribution(
  simulations: SimulationExamDto[],
): LossReasonDistributionSummary {
  const reasonMap = new Map<SimulationLossReasonDto, { lostScore: number; count: number }>();

  let totalLostScore = 0;
  let totalLossItemsCount = 0;

  for (const exam of simulations) {
    for (const sub of exam.subjectResults) {
      for (const item of sub.lossItems) {
        if (item.archivedAt) continue;
        const reason = item.reason;
        const current = reasonMap.get(reason) ?? { lostScore: 0, count: 0 };
        current.lostScore += item.lostScore;
        current.count += 1;
        reasonMap.set(reason, current);

        totalLostScore += item.lostScore;
        totalLossItemsCount += 1;
      }
    }
  }

  totalLostScore = Math.round(totalLostScore * 10) / 10;

  const items: LossReasonDistributionItem[] = Array.from(reasonMap.entries())
    .map(([reason, data]) => {
      const meta = getLossReasonMeta(reason);
      const lostScore = Math.round(data.lostScore * 10) / 10;
      const percentage =
        totalLostScore > 0 ? Math.round((lostScore / totalLostScore) * 1000) / 10 : 0;

      return {
        reason,
        meta,
        totalLostScore: lostScore,
        itemCount: data.count,
        percentage,
      };
    })
    .sort((a, b) => b.totalLostScore - a.totalLostScore || b.itemCount - a.itemCount);

  return {
    items,
    totalLostScore,
    totalLossItemsCount,
  };
}

// ============================================================================
// 5. Weak Module Loss Ranking Table
// ============================================================================

export interface WeakModuleLossRankItem {
  id: string;
  rank: number;
  title: string;
  subjectName: string;
  subjectColor: string;
  syllabusNodeId: string | null;
  totalLostScore: number;
  lossCount: number;
  primaryReason: SimulationLossReasonDto;
  primaryReasonLabel: string;
  lastExamDate: string;
  notes: string[];
}

export function calculateWeakModuleLossRankings(
  simulations: SimulationExamDto[],
  maxItems = 5,
): WeakModuleLossRankItem[] {
  const nodeMap = new Map<
    string,
    {
      syllabusNodeId: string | null;
      title: string;
      subjectName: string;
      subjectColor: string;
      totalLostScore: number;
      lossCount: number;
      reasonCounts: Map<SimulationLossReasonDto, number>;
      lastExamDate: string;
      notes: string[];
    }
  >();

  for (const exam of simulations) {
    for (const sub of exam.subjectResults) {
      for (const item of sub.lossItems) {
        if (item.archivedAt) continue;

        const title = item.syllabusNodeTitle || item.note || `考点模块 [${item.reason}]`;
        const key = item.syllabusNodeId ? `node:${item.syllabusNodeId}` : `title:${sub.subjectName}:${title}`;

        const current = nodeMap.get(key) ?? {
          syllabusNodeId: item.syllabusNodeId,
          title,
          subjectName: sub.subjectName,
          subjectColor: sub.subjectColor || "#2dd4bf",
          totalLostScore: 0,
          lossCount: 0,
          reasonCounts: new Map<SimulationLossReasonDto, number>(),
          lastExamDate: exam.examDate,
          notes: [],
        };

        current.totalLostScore += item.lostScore;
        current.lossCount += 1;
        current.reasonCounts.set(
          item.reason,
          (current.reasonCounts.get(item.reason) ?? 0) + item.lostScore,
        );

        if (new Date(exam.examDate).getTime() > new Date(current.lastExamDate).getTime()) {
          current.lastExamDate = exam.examDate;
        }
        if (item.note && !current.notes.includes(item.note)) {
          current.notes.push(item.note);
        }

        nodeMap.set(key, current);
      }
    }
  }

  const sorted = Array.from(nodeMap.entries())
    .map(([key, data]) => {
      // Find reason with maximum lost score
      let primaryReason: SimulationLossReasonDto = "CONCEPT_GAP";
      let maxReasonScore = -1;
      for (const [r, score] of data.reasonCounts.entries()) {
        if (score > maxReasonScore) {
          maxReasonScore = score;
          primaryReason = r;
        }
      }

      return {
        id: key,
        title: data.title,
        subjectName: data.subjectName,
        subjectColor: data.subjectColor,
        syllabusNodeId: data.syllabusNodeId,
        totalLostScore: Math.round(data.totalLostScore * 10) / 10,
        lossCount: data.lossCount,
        primaryReason,
        primaryReasonLabel: getLossReasonMeta(primaryReason).shortLabel,
        lastExamDate: data.lastExamDate,
        notes: data.notes.slice(0, 2),
      };
    })
    .sort((a, b) => b.totalLostScore - a.totalLostScore || b.lossCount - a.lossCount);

  return sorted.slice(0, maxItems).map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}

// ============================================================================
// 6. Today's Pending Test Queue (Due Retests + Incomplete Simulation Drafts)
// ============================================================================

export type PendingTestQueueItem =
  | {
      kind: "retest";
      id: string;
      title: string;
      method: string;
      pointCount: number;
      pointTitles: string[];
      status: KnowledgeRetestStatusDto;
      dueStatus: "overdue" | "due_today" | "upcoming" | "in_progress";
      dueText: string;
      actionUrl: string;
      actionLabel: string;
      scheduledDate: string | null;
    }
  | {
      kind: "simulation_draft";
      id: string;
      name: string;
      examDate: string;
      subjectCount: number;
      status: "DRAFT" | "IN_PROGRESS" | "CONFIRMED";
      dueStatus: "draft_pending";
      dueText: string;
      actionUrl: string;
      actionLabel: string;
      scheduledDate: string;
    };

export function buildPendingTestQueue(
  retests: KnowledgeRetestListItemDto[],
  simulations: SimulationExamDto[],
  now = new Date(),
): PendingTestQueueItem[] {
  const queue: PendingTestQueueItem[] = [];

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;

  // 1. Open Retests
  const openRetests = retests.filter((r) => r.status !== "CLOSED" && r.status !== "VOIDED");
  for (const retest of openRetests) {
    let dueStatus: "overdue" | "due_today" | "upcoming" | "in_progress" = "due_today";
    let dueText = "今日待测";

    if (retest.status === "IN_PROGRESS") {
      dueStatus = "in_progress";
      dueText = "进行中";
    } else if (retest.nextDueAt || retest.scheduledAt) {
      const targetTime = new Date(retest.nextDueAt ?? retest.scheduledAt ?? "").getTime();
      if (targetTime < todayStart) {
        dueStatus = "overdue";
        const daysAgo = Math.max(1, Math.floor((todayStart - targetTime) / (24 * 60 * 60 * 1000)));
        dueText = `逾期 ${daysAgo} 天`;
      } else if (targetTime <= todayEnd) {
        dueStatus = "due_today";
        dueText = "今日到期";
      } else {
        dueStatus = "upcoming";
        const daysLater = Math.ceil((targetTime - todayEnd) / (24 * 60 * 60 * 1000));
        dueText = `${daysLater} 天后到期`;
      }
    }

    queue.push({
      kind: "retest" as const,
      id: retest.id,
      title: retest.title,
      method: retest.method,
      pointCount: retest.pointCount,
      pointTitles: retest.pointTitles,
      status: retest.status,
      dueStatus,
      dueText,
      actionUrl: `/test/retests/${retest.id}`,
      actionLabel: retest.status === "IN_PROGRESS" ? "继续复测" : "开始复测",
      scheduledDate: retest.nextDueAt ?? retest.scheduledAt,
    });
  }

  // 2. Draft / In-Progress Simulations
  const draftExams = simulations.filter(
    (exam) => exam.status === "DRAFT" || exam.status === "IN_PROGRESS",
  );
  for (const exam of draftExams) {
    const hasSubjects = exam.subjectResults.length > 0;
    const actionLabel = hasSubjects ? "继续核对失分" : "录入分科成绩";

    queue.push({
      kind: "simulation_draft" as const,
      id: exam.id,
      name: exam.name,
      examDate: exam.examDate,
      subjectCount: exam.subjectResults.length,
      status: exam.status,
      dueStatus: "draft_pending",
      dueText: "模考未收口",
      actionUrl: `/test/simulations/${exam.id}`,
      actionLabel,
      scheduledDate: exam.examDate,
    });
  }

  // Sort queue: overdue first, then in_progress, then due_today, then simulation drafts, then upcoming
  const priorityOrder = {
    overdue: 1,
    in_progress: 2,
    due_today: 3,
    draft_pending: 4,
    upcoming: 5,
  };

  return queue.sort((a, b) => {
    const pA = priorityOrder[a.dueStatus] ?? 99;
    const pB = priorityOrder[b.dueStatus] ?? 99;
    if (pA !== pB) return pA - pB;
    const nameA = a.kind === "retest" ? a.title : a.name;
    const nameB = b.kind === "retest" ? b.title : b.name;
    return nameA.localeCompare(nameB);
  });
}
