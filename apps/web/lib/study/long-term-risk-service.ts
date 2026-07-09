import {
  summarizeLongTermRisks,
  type LongTermRiskEvidenceFreshness,
  type LongTermRiskStageInput,
  type LongTermRiskSummary,
  type LongTermRiskWeakNodeInput,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { getAnalyticsSummary } from "./analytics-service";
import { daysUntil } from "./date";
import { getTodayDashboard } from "./service";
import { getSyllabusMapOverview } from "./syllabus-service";
import type { SyllabusNodeDto } from "./types";

const simulationDate = new Date("2026-12-20T08:30:00+08:00");
const finalExamDate = new Date("2027-12-20T08:30:00+08:00");

export type LongTermRiskSummaryDto = LongTermRiskSummary;

export async function getLongTermRiskSummary(now = new Date()): Promise<LongTermRiskSummaryDto> {
  const [analytics, dashboard, syllabusMap, latestSimulation, stage] = await Promise.all([
    getAnalyticsSummary(now),
    getTodayDashboard(now),
    getSyllabusMapOverview(),
    getLatestSimulationInput(now),
    getStageInput(now),
  ]);

  return ensureLongTermRiskDtoContract(summarizeLongTermRisks({
    window: {
      start: analytics.range.start,
      end: analytics.range.end,
      label: "近 7 天",
    },
    effectiveMinutes: analytics.totals.weekEffectiveMinutes,
    taskCompletionRate: analytics.totals.weeklyTaskCompletionRate,
    debtCount: dashboard.metrics.debtCount,
    lowConversionCount: analytics.totals.lowConversionCount,
    reviewCompletionRate: analytics.totals.reviewCompletionRate,
    dueMistakeCount: analytics.totals.dueMistakes,
    dueNoteCount: analytics.totals.dueNotes,
    weakNodes: createWeakNodeInputs(syllabusMap.nodes),
    simulation: latestSimulation,
    stage,
    themeState: dashboard.snapshot.themeState,
  }));
}

async function getLatestSimulationInput(now: Date) {
  const exam = await prisma.simulationExam.findFirst({
    where: {
      actualScore: { not: null },
      targetScore: { not: null },
    },
    include: {
      subjectResults: {
        include: { subject: true },
      },
    },
    orderBy: [{ examDate: "desc" }, { updatedAt: "desc" }],
  });

  const latestScoreRate = exam?.actualScore != null && exam.targetScore != null && exam.targetScore > 0
    ? exam.actualScore / exam.targetScore
    : null;
  const weakSubjectNames = exam?.subjectResults
    .filter((result) => result.actualScore != null && result.targetScore != null && result.targetScore > 0)
    .filter((result) => (result.actualScore ?? 0) / (result.targetScore ?? 1) < 0.6)
    .map((result) => result.subject.name) ?? [];

  return {
    latestScoreRate,
    daysToNextSimulation: daysUntil(simulationDate, now),
    weakSubjectNames,
    isFirstSynchronized: exam?.isFirstSynchronized ?? false,
  };
}

async function getStageInput(now: Date): Promise<LongTermRiskStageInput | null> {
  const [activePlan, draftPlan, activeDraftCount] = await Promise.all([
    prisma.stagePlan.findFirst({
      where: { status: "active" },
      orderBy: [{ endDate: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.stagePlan.findFirst({
      where: { status: "draft" },
      orderBy: [{ startDate: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.stageAdjustmentDraft.count({
      where: { status: "draft" },
    }),
  ]);
  const plan = activePlan ?? draftPlan;
  if (!plan) return null;

  return {
    mode: plan.mode,
    goal: plan.goal,
    daysToFinal: daysUntil(finalExamDate, now),
    activeDraftCount,
  };
}

function createWeakNodeInputs(nodes: SyllabusNodeDto[]): LongTermRiskWeakNodeInput[] {
  return flattenNodes(nodes)
    .filter((node) => isLongTermRiskNode(node))
    .map((node) => ({
      id: node.id,
      title: node.title,
      subjectName: node.subjectName,
      status: node.mapSignal.cellStatus,
      mistakeCount: node.evidence.mistakeCount,
      evidenceFreshness: determineEvidenceFreshness(node),
    }))
    .sort((left, right) => {
      const mistakeDiff = right.mistakeCount - left.mistakeCount;
      if (mistakeDiff !== 0) return mistakeDiff;
      return freshnessRank(left.evidenceFreshness) - freshnessRank(right.evidenceFreshness);
    })
    .slice(0, 8);
}

function flattenNodes(nodes: SyllabusNodeDto[]): SyllabusNodeDto[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

function isLongTermRiskNode(node: SyllabusNodeDto): boolean {
  return (
    node.mapSignal.cellStatus === "weak" ||
    node.mapSignal.cellStatus === "forgetting_risk" ||
    node.mapSignal.cellStatus === "mistake_hotspot" ||
    node.status === "weak" ||
    node.status === "needs_review"
  );
}

function determineEvidenceFreshness(node: SyllabusNodeDto): LongTermRiskEvidenceFreshness {
  const days = node.evidence.daysSinceLastEvidence;
  if (days == null) return "unknown";
  return days <= 14 ? "fresh" : "stale";
}

function freshnessRank(freshness: LongTermRiskEvidenceFreshness | undefined): number {
  switch (freshness) {
    case "stale":
      return 0;
    case "unknown":
      return 1;
    case "fresh":
      return 2;
    default:
      return 3;
  }
}

function ensureLongTermRiskDtoContract(summary: LongTermRiskSummary): LongTermRiskSummary {
  const firstRisk = summary.risks[0];
  if (firstRisk) {
    void firstRisk.evidenceFreshness;
    void firstRisk.nextAction;
  }
  return summary;
}
