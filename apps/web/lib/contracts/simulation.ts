import type {
  SimulationLossReason,
  SimulationReadinessSummary,
  StageAdjustmentDraft,
} from "@areaforge/core";
import type {
  PlanInboxWriteSummaryDto,
} from "./plan-inbox";
import type { MotivationVaultDto } from "./motivation";
import type { StageAdjustmentDraftRecordDto, StagePlanDto } from "./stage";
import type { StudyTaskDto } from "./task";

export interface SimulationSubjectResultDto {
  id: string;
  simulationExamId: string;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  paperFullScore: number | null;
  targetScore: number | null;
  actualScore: number | null;
  durationMinutes: number | null;
  blankQuestionCount: number;
  lossReasons: string[];
  summary: string | null;
  revision: number;
  lossItems: SimulationLossItemDto[];
}

export type SimulationLossReasonDto =
  | "CONCEPT_GAP"
  | "MEMORY_FORMULA"
  | "METHOD_ERROR"
  | "CALCULATION_CARELESS"
  | "TIME_ALLOCATION"
  | "READING_COMPREHENSION"
  | "UNFAMILIAR_PATTERN"
  | "MINDSET"
  | "UNANSWERED"
  | "OTHER";

export interface SimulationLossItemDto {
  id: string;
  reason: SimulationLossReasonDto;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  lostScore: number;
  note: string | null;
  mistakeId: string | null;
  revision: number;
  archivedAt: string | null;
}

export interface SimulationExamDto {
  id: string;
  name: string;
  examDate: string;
  isFirstSynchronized: boolean;
  targetDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  targetScore: number | null;
  actualScore: number | null;
  blankQuestionCount: number;
  lossReasons: string[];
  mindset: string | null;
  summary: string | null;
  reviewText: string | null;
  status: "DRAFT" | "IN_PROGRESS" | "CONFIRMED";
  timerSessionId: string | null;
  timerSessionStatus: "RUNNING" | "PAUSED" | "CLOSING" | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  totalsSource: "subject_sum" | "legacy_fallback";
  legacyDisplayTotals: { targetScore: number | null; actualScore: number | null } | null;
  warnings: string[];
  subjectResults: SimulationSubjectResultDto[];
}

export interface SimulationStageDraftDto {
  simulationNode: {
    title: string;
    date: string;
    daysToSimulation: number;
    isPhaseNode: true;
  } | null;
  readiness: SimulationReadinessSummary;
  draft: {
    status: "local_rule_fallback";
    riskConclusion: string;
    focusSubjects: string[];
    intensityAdjustment: string;
    modeRecommendation: "recovery" | "strengthening" | "simulation_window" | "steady";
    taskActions: string[];
    risk: StageAdjustmentDraft["risk"];
    taskIntensity: StageAdjustmentDraft["taskIntensity"];
    requiresUserConfirmation: true;
    canAutoApply: false;
    privacyBoundary: string;
  };
}

export interface SimulationWorkspaceDto {
  exams: SimulationExamDto[];
  tasks: StudyTaskDto[];
  stage: SimulationStageDraftDto;
  stagePlans: StagePlanDto[];
  stageAdjustmentDrafts: StageAdjustmentDraftRecordDto[];
  motivationVault: MotivationVaultDto | null;
}

export interface SimulationRemediationDto {
  originKey: string;
  subjectResultId: string;
  subjectId: string;
  subjectName: string;
  reason: SimulationLossReason;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  lostScore: number;
  itemIds: string[];
  originVersion: number;
  inboxItemId: string | null;
  inboxStatus: "OPEN" | "DISMISSED" | "CONVERTED" | null;
}

export interface StagePlanConflictLatest {
  kind: "stage-plan";
  plan: StagePlanDto | null;
  commandState?: "conflict" | "result_unavailable" | "workspace_changed";
  sourceConflict?: unknown;
}

export interface StageAdjustmentConflictLatest {
  kind: "stage-adjustment-decision";
  draft: StageAdjustmentDraftRecordDto | null;
  stagePlan: StagePlanDto | null;
  commandState?: "conflict" | "result_unavailable" | "workspace_changed";
  sourceConflict?: unknown;
}

export interface StageAdjustmentDecisionResult {
  draft: StageAdjustmentDraftRecordDto;
  stageDraftId: string;
  inboxResult: PlanInboxWriteSummaryDto;
}

export interface StageAdjustmentDecisionReplay {
  draft: StageAdjustmentDraftRecordDto;
  status: "applied" | "rejected";
  decidedAt: string | null;
  inboxResult: PlanInboxWriteSummaryDto | null;
}
