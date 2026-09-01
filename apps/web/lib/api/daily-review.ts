import { createJsonRequest, requestApiResult, type ApiErrorEnvelope, type ApiResult } from "@/lib/api/client";
import type { DailyReviewDto, PlanInboxItemDto } from "@/lib/contracts";

export interface DailyReviewContentInput {
  idempotencyKey: string;
  summary: string;
  lostControl?: string;
  keepAction: string;
  tomorrowMinimum: string;
  mood?: string;
}

export interface UpdateDailyReviewInput extends DailyReviewContentInput {
  expectedRevision: number;
}

export interface DailyReviewResponse extends ApiErrorEnvelope<DailyReviewDto> {
  review?: DailyReviewDto;
  inboxItem?: PlanInboxItemDto;
}

export function createDailyReview(
  input: DailyReviewContentInput,
): Promise<ApiResult<DailyReviewResponse>> {
  return requestApiResult("/api/daily-reviews", createJsonRequest("POST", input));
}

export function updateDailyReview(
  reviewId: string,
  input: UpdateDailyReviewInput,
): Promise<ApiResult<DailyReviewResponse>> {
  return requestApiResult(
    `/api/daily-reviews/${encodeURIComponent(reviewId)}`,
    createJsonRequest("PATCH", input),
  );
}
