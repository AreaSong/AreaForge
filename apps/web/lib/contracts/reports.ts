import type {
  createPeriodicNextCycleDraft,
  createPeriodicReportDecisionSnapshot,
} from "@areaforge/core";
import type { ActivityBreakdown } from "./activity";
import type { PlanInboxWriteSummaryDto } from "./plan-inbox";
import type { StageAdjustmentDraftRecordDto, StagePlanDto } from "./stage";

export type PeriodicReportKind = "week" | "month";
type PeriodicNextCycleDraftDto = ReturnType<typeof createPeriodicNextCycleDraft>;
type PeriodicDecisionSnapshotDto = ReturnType<typeof createPeriodicReportDecisionSnapshot>;

export interface PeriodicSubjectShareDto {
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  totalMinutes: number;
  effectiveMinutes: number;
  share: number;
  debtCount: number;
  mistakeCount: number;
  activity: ActivityBreakdown;
}

export interface PeriodicReportDecisionDto {
  id: string;
  kind: PeriodicReportKind;
  range: { start: string; end: string };
  status: "confirmed" | "rejected";
  reportSnapshot: PeriodicDecisionSnapshotDto;
  nextCycleDraft: PeriodicNextCycleDraftDto | null;
  canAutoApply: false;
  requiresUserConfirmation: true;
  decidedAt: string;
  actorId: string | null;
  stageDraftId: string | null;
  inboxResult: PlanInboxWriteSummaryDto;
  alreadyDecided?: boolean;
}

export interface PeriodicReportDto {
  id: string;
  revision: number;
  kind: PeriodicReportKind;
  title: string;
  range: { start: string; end: string; days: number };
  metrics: {
    totalMinutes: number;
    effectiveMinutes: number;
    taskCompletionRate: number | null;
    taskCount: number;
    completedTaskCount: number;
    debtCount: number;
    lowConversionCount: number;
    reviewCompletionRate: number | null;
    reviewSampleDays: number;
    reviewCount: number;
    mistakesCreatedCount: number;
    mistakeReviewUpdateCount: number;
    dueNoteCount: number;
    weakNodeCount: number;
    activity: ActivityBreakdown;
  };
  subjectShares: PeriodicSubjectShareDto[];
  debtPreview: Array<{ id: string; title: string; subjectName: string; plannedDate: string }>;
  weakness: {
    title: string;
    detail: string;
    source: "syllabus_node" | "debt_subject" | "zero_effective_subject" | "low_conversion" | "simulation_loss" | "none";
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
