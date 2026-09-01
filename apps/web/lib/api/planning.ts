import { createJsonRequest, requestApiResult, type ApiErrorEnvelope, type ApiResult } from "@/lib/api/client";
import type { PlanMilestoneDto, PlanRollingDto } from "@/lib/contracts";

export interface PlanMilestoneResponse extends ApiErrorEnvelope<PlanMilestoneDto> {
  milestone?: PlanMilestoneDto;
  milestones?: PlanMilestoneDto[];
}

export interface CreatePlanMilestoneInput {
  idempotencyKey?: string;
  stagePlanId: string;
  expectedStagePlanRevision?: number;
  stableKey: string;
  title: string;
  subjectId?: string | null;
  targetDate?: string | null;
  sortOrder?: number;
}

export interface PlanRollingQuery {
  date?: string;
  subjectId?: string;
  status?: string;
  q?: string;
}

export interface PlanRollingResponse {
  plan?: PlanRollingDto;
  error?: string;
}

export function listPlanMilestones(): Promise<ApiResult<PlanMilestoneResponse>> {
  return requestApiResult("/api/plan-milestones", { cache: "no-store" });
}

export function createPlanMilestone(
  input: CreatePlanMilestoneInput,
): Promise<ApiResult<PlanMilestoneResponse>> {
  return requestApiResult(
    "/api/plan-milestones",
    createJsonRequest("POST", input),
  );
}

export function getPlanRolling(
  query: PlanRollingQuery = {},
): Promise<ApiResult<PlanRollingResponse>> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) search.set(key, value);
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return requestApiResult(`/api/plan/rolling${suffix}`, { cache: "no-store" });
}
