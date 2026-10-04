import { createJsonRequest, requestApiResult, type ApiErrorEnvelope, type ApiResult } from "@/lib/api/client";
import type { PlanInboxItemDto } from "@/lib/contracts";

export interface PlanInboxApiResponse extends ApiErrorEnvelope<PlanInboxItemDto> {
  item?: PlanInboxItemDto;
}

export interface UpdatePlanInboxInput {
  expectedRevision: number;
  title?: string;
  subjectId?: string | null;
  plannedDate?: string | null;
  estimatedMinutes?: number | null;
  priority?: string | null;
  type?: string | null;
  planMilestoneId?: string | null;
  primaryNodeId?: string | null;
  relatedNodeIds?: string[];
  predecessorTasks?: Array<{ taskId: string; dependencyType: "SOFT" | "HARD" }>;
}

export interface ConvertPlanInboxInput {
  expectedRevision: number;
  idempotencyKey: string;
}

export interface LowConversionResponse {
  item?: PlanInboxItemDto;
  error?: string;
}

export interface AnalyticsRiskInboxResponse {
  item?: PlanInboxItemDto;
  latest?: { risks?: unknown[] };
  error?: string;
}

export type PlanInboxTransition = "dismiss" | "reopen";

export type PlanInboxCommand =
  | { type: "update"; itemId: string; input: UpdatePlanInboxInput }
  | { type: "convert"; itemId: string; input: ConvertPlanInboxInput }
  | { type: PlanInboxTransition; itemId: string; expectedRevision: number };

export function updatePlanInboxItem(
  itemId: string,
  input: UpdatePlanInboxInput,
): Promise<ApiResult<PlanInboxApiResponse>> {
  return executePlanInboxCommand({ type: "update", itemId, input });
}

export function convertPlanInboxItem(
  itemId: string,
  input: ConvertPlanInboxInput,
): Promise<ApiResult<PlanInboxApiResponse>> {
  return executePlanInboxCommand({ type: "convert", itemId, input });
}

export function transitionPlanInboxItem(
  itemId: string,
  transition: PlanInboxTransition,
  expectedRevision: number,
): Promise<ApiResult<PlanInboxApiResponse>> {
  return executePlanInboxCommand({ type: transition, itemId, expectedRevision });
}

export function executePlanInboxCommand(
  command: PlanInboxCommand,
): Promise<ApiResult<PlanInboxApiResponse>> {
  switch (command.type) {
    case "update":
      return requestApiResult(
        `/api/plan-inbox/${encodeURIComponent(command.itemId)}`,
        createJsonRequest("PATCH", command.input),
      );
    case "convert":
      return requestApiResult(
        `/api/plan-inbox/${encodeURIComponent(command.itemId)}/convert`,
        createJsonRequest("POST", command.input),
      );
    case "dismiss":
    case "reopen":
      return requestApiResult(
        `/api/plan-inbox/${encodeURIComponent(command.itemId)}/${command.type}`,
        createJsonRequest("POST", { expectedRevision: command.expectedRevision }),
      );
  }
}

export function addLowConversionToInbox(
  sessionId: string,
  expectedCloseoutVersion: number,
): Promise<ApiResult<LowConversionResponse>> {
  return requestApiResult(
    "/api/plan-inbox/low-conversion",
    createJsonRequest("POST", { sessionId, expectedCloseoutVersion }),
  );
}

export function addAnalyticsRiskToInbox(input: {
  riskId: string;
  riskType: "weak_node" | "note_review" | "mistake_review" | "review_gap" | "low_completion" | "low_effective";
  windowDays: 7 | 30;
}): Promise<ApiResult<AnalyticsRiskInboxResponse>> {
  return requestApiResult(
    "/api/plan-inbox/analytics-risk",
    createJsonRequest("POST", input),
  );
}

export function adoptAiPlan(
  body: unknown,
): Promise<ApiResult<{ error?: string }>> {
  return requestApiResult(
    "/api/plan-inbox/ai-plan-adoptions",
    createJsonRequest("POST", body),
  );
}
