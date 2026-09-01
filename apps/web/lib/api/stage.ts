import { createJsonRequest, requestApiResult, type ApiErrorEnvelope, type ApiResult } from "@/lib/api/client";
import type {
  PlanMilestoneDto,
  StageAdjustmentDraftRecordDto,
  StagePlanDto,
} from "@/lib/contracts";

type StageApiError = ApiErrorEnvelope<StagePlanDto | StageAdjustmentDraftRecordDto | PlanMilestoneDto>;

export interface CreateStagePlanInput {
  idempotencyKey: string;
  baseRevision: number | null;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  mode: StagePlanDto["mode"];
  status: StagePlanDto["status"];
}

export interface StagePlanResponse extends StageApiError {
  plan?: StagePlanDto;
}

export interface CreateStageAdjustmentDraftInput {
  idempotencyKey: string;
  stagePlanId?: string | null;
}

export interface StageAdjustmentDecisionInput {
  expectedRevision: number;
}

export interface StageAdjustmentResponse extends StageApiError {
  draft?: StageAdjustmentDraftRecordDto;
  inboxResult?: {
    createdCount: number;
    reusedCount: number;
    supersededCount: number;
  };
}

export interface CreateStageMilestoneInput {
  idempotencyKey: string;
  stagePlanId: string;
  expectedStagePlanRevision: number;
  stableKey: string;
  title: string;
  targetDate: string | null;
  sortOrder: number;
}

export interface UpdateStageMilestoneInput {
  expectedRevision: number;
  title?: string;
  targetDate?: string | null;
  sortOrder?: number;
  status?: string;
  archive?: boolean;
}

export interface StageMilestoneResponse extends StageApiError {
  milestone?: PlanMilestoneDto;
}

export function createStagePlan(
  input: CreateStagePlanInput,
): Promise<ApiResult<StagePlanResponse>> {
  return requestApiResult("/api/stage-plans", createJsonRequest("POST", input));
}

export function createStageAdjustmentDraft(
  input: CreateStageAdjustmentDraftInput,
): Promise<ApiResult<StageAdjustmentResponse>> {
  return requestApiResult(
    "/api/stage-adjustment-drafts",
    createJsonRequest("POST", input),
  );
}

export function decideStageAdjustmentDraft(
  draftId: string,
  action: "confirm" | "reject",
  input: StageAdjustmentDecisionInput,
): Promise<ApiResult<StageAdjustmentResponse>> {
  return requestApiResult(
    `/api/stage-adjustment-drafts/${encodeURIComponent(draftId)}/${action}`,
    createJsonRequest("POST", input),
  );
}

export function createStageMilestone(
  input: CreateStageMilestoneInput,
): Promise<ApiResult<StageMilestoneResponse>> {
  return requestApiResult("/api/plan-milestones", createJsonRequest("POST", input));
}

export function updateStageMilestone(
  milestoneId: string,
  input: UpdateStageMilestoneInput,
): Promise<ApiResult<StageMilestoneResponse>> {
  return requestApiResult(
    `/api/plan-milestones/${encodeURIComponent(milestoneId)}`,
    createJsonRequest("PATCH", input),
  );
}
