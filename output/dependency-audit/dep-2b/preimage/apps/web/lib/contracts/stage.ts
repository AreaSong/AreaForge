export type StagePlanModeDto = "recovery" | "strengthen" | "sprint" | "maintain";
export type StagePlanStatusDto = "draft" | "active" | "completed" | "archived";
export type StageAdjustmentDraftSourceDto = "local_rule" | "ai";
export type StageAdjustmentDraftStatusDto = "draft" | "applied" | "rejected";
export type StageAdjustmentDraftRiskDto = "low" | "medium" | "high" | "critical";
export type StageAdjustmentTaskIntensityDto = "reduce" | "keep" | "increase" | "sprint";
export type StageAdjustmentTaskActionDto =
  | "split"
  | "defer"
  | "drop"
  | "convert_review"
  | "simulate"
  | "retest";

export interface StagePlanDto {
  id: string;
  revision: number;
  name: string;
  startDate: string;
  endDate: string;
  goal: string;
  mode: StagePlanModeDto;
  status: StagePlanStatusDto;
  createdAt: string;
  updatedAt: string;
}

export interface StageAdjustmentDraftRecordDto {
  id: string;
  revision: number;
  stagePlanId: string | null;
  sourceReportDecisionId: string | null;
  sourceReportRevision: number | null;
  originVersion: number | null;
  source: StageAdjustmentDraftSourceDto;
  mode: StagePlanModeDto;
  risk: StageAdjustmentDraftRiskDto;
  riskConclusion: string;
  focusSubjects: string[];
  taskIntensity: StageAdjustmentTaskIntensityDto;
  taskAdjustmentActions: StageAdjustmentTaskActionDto[];
  nextStageEmphasis: string;
  canAutoApply: false;
  requiresUserConfirmation: true;
  status: StageAdjustmentDraftStatusDto;
  createdAt: string;
  appliedAt: string | null;
  actorId: string | null;
}
