import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type {
  ActionCenterRecommendationFeedbackDto,
  ActionCenterTodayDto,
} from "@/lib/contracts";

interface RecommendationFeedbackResponse {
  today?: ActionCenterTodayDto;
  latest?: ActionCenterTodayDto["recommendation"];
  error?: string;
}

interface ActionCenterTodayResponse {
  today?: ActionCenterTodayDto;
  error?: string;
}

export function readActionCenterToday(signal?: AbortSignal): Promise<ApiResult<ActionCenterTodayResponse>> {
  return requestApiResult("/api/action-center/today", {
    cache: "no-store",
    signal,
  });
}

export function sendActionCenterRecommendationFeedback(input: {
  studyDate: string;
  recommendationId: string;
  recommendationKind: NonNullable<ActionCenterTodayDto["recommendation"]>["kind"];
  feedback: ActionCenterRecommendationFeedbackDto;
}): Promise<ApiResult<RecommendationFeedbackResponse>> {
  return requestApiResult(
    "/api/action-center/recommendation-feedback",
    createJsonRequest("POST", input),
  );
}
