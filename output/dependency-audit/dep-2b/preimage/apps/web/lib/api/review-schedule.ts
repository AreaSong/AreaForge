import { createJsonRequest, requestApiResult, type ApiErrorEnvelope, type ApiResult } from "@/lib/api/client";
import type { ReviewEventDto, ReviewScheduleDto } from "@/lib/contracts";

export interface ReviewScheduleApiResponse extends ApiErrorEnvelope<ReviewScheduleDto> {
  schedule?: ReviewScheduleDto;
}

export interface ConfirmReviewEventResponse extends ReviewScheduleApiResponse {
  event?: ReviewEventDto;
  reused?: boolean;
  nextScheduleId?: string | null;
}

export function createReviewSchedule(body: unknown): Promise<ApiResult<ReviewScheduleApiResponse>> {
  return requestApiResult("/api/review-schedules", createJsonRequest("POST", body));
}

export function rescheduleReview(
  id: string,
  body: unknown,
): Promise<ApiResult<ReviewScheduleApiResponse>> {
  return requestApiResult(
    `/api/review-schedules/${encodeURIComponent(id)}`,
    createJsonRequest("PATCH", body),
  );
}

export function pauseReviewSchedule(
  id: string,
  body: unknown,
): Promise<ApiResult<ReviewScheduleApiResponse>> {
  return requestApiResult(
    `/api/review-schedules/${encodeURIComponent(id)}/pause`,
    createJsonRequest("POST", body),
  );
}

export function resumeReviewSchedule(
  id: string,
  body: unknown,
): Promise<ApiResult<ReviewScheduleApiResponse>> {
  return requestApiResult(
    `/api/review-schedules/${encodeURIComponent(id)}/resume`,
    createJsonRequest("POST", body),
  );
}

export function confirmReviewEvent(
  id: string,
  body: unknown,
): Promise<ApiResult<ConfirmReviewEventResponse>> {
  return requestApiResult(
    `/api/review-schedules/${encodeURIComponent(id)}/events`,
    createJsonRequest("POST", body),
  );
}
