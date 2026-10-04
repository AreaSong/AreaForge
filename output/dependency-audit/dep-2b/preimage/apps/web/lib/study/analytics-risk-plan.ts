import type { AnalyticsRiskItemDto, AnalyticsSummaryDto } from "@/lib/contracts";

export interface AnalyticsRiskPlanDraft {
  stableKey: string;
  originKey: string;
  originVersion: number;
  originType: "ANALYTICS_RISK";
  originSnapshot: Record<string, unknown>;
  title: string;
  plannedDate: string;
  estimatedMinutes: number;
  priority: "MEDIUM" | "HIGH" | "CRITICAL";
  type: "focus";
  primaryNodeId: string | null;
  relatedNodeIds: string[];
}

export function buildAnalyticsRiskPlanDraft(
  analytics: Pick<AnalyticsSummaryDto, "range">,
  risk: AnalyticsRiskItemDto,
  windowDays: 7 | 30,
  plannedDate: string,
): AnalyticsRiskPlanDraft {
  const startKey = analytics.range.start.slice(0, 10);
  const endKey = analytics.range.end.slice(0, 10);
  const originKey = `analytics-risk:${windowDays}:${risk.type}:${risk.id}:${startKey}:${endKey}`;
  return {
    stableKey: `${originKey}:v1`,
    originKey,
    originVersion: 1,
    originType: "ANALYTICS_RISK",
    originSnapshot: {
      provenanceVersion: 1,
      source: "ANALYTICS_RISK",
      windowDays,
      range: analytics.range,
      riskId: risk.id,
      riskType: risk.type,
      severity: risk.severity,
      title: risk.title,
      detail: risk.detail,
      action: risk.action,
      subjectName: risk.subjectName ?? null,
      syllabusNodeId: risk.syllabusNodeId ?? null,
      syllabusNodeTitle: risk.syllabusNodeTitle ?? null,
      dueAt: risk.dueAt ?? null,
    },
    title: risk.action.trim() || risk.title,
    plannedDate,
    estimatedMinutes: riskMinutes(risk),
    priority: risk.severity === "danger" ? "CRITICAL" : risk.severity === "warning" ? "HIGH" : "MEDIUM",
    type: "focus",
    primaryNodeId: risk.syllabusNodeId ?? null,
    relatedNodeIds: risk.syllabusNodeId ? [risk.syllabusNodeId] : [],
  };
}

function riskMinutes(risk: AnalyticsRiskItemDto): number {
  if (risk.type === "note_review" || risk.type === "mistake_review") return 15;
  if (risk.type === "review_gap") return 10;
  if (risk.type === "weak_node") return 30;
  return 25;
}
