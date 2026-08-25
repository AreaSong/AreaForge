import type { LongTermRiskSummary } from "@areaforge/core";
import type { ActivityBreakdown } from "./activity";

export interface AnalyticsDailyPointDto {
  dayKey: string;
  totalMinutes: number;
  effectiveMinutes: number;
  taskCompletionRate: number;
  reviewSubmitted: boolean;
  activity: ActivityBreakdown;
}

export interface AnalyticsSubjectShareDto {
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  totalMinutes: number;
  effectiveMinutes: number;
  share: number;
  activity: ActivityBreakdown;
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
    activity: ActivityBreakdown;
  };
  daily: AnalyticsDailyPointDto[];
  subjects: AnalyticsSubjectShareDto[];
  risks: AnalyticsRiskItemDto[];
  actions: string[];
}

export type LongTermRiskSummaryDto = LongTermRiskSummary;
