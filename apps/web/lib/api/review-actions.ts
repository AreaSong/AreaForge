import { createJsonRequest, requestApiResult, type ApiErrorEnvelope, type ApiResult } from "@/lib/api/client";
import type { ReviewEventDto, StudyTaskDto } from "@/lib/contracts";

export type ReviewResult = "PASSED" | "PARTIAL" | "FAILED";

type ReviewActionResponse = ApiErrorEnvelope<ReviewEventDto | StudyTaskDto>;

export interface CorrectReviewEventInput {
  idempotencyKey: string;
  expectedRevision: number;
  result: ReviewResult;
  nextDueDate?: string;
  note?: string | null;
}

export interface CompleteReviewBridgeInput {
  idempotencyKey: string;
  expectedRevision: number;
  result: ReviewResult;
  durationSeconds: number;
  nextDueDate?: string;
  note?: string | null;
}

export interface DeferReviewBridgeInput {
  expectedScheduleRevision: number;
  plannedDate: string;
}

export function correctReviewEvent(
  eventId: string,
  input: CorrectReviewEventInput,
): Promise<ApiResult<ReviewActionResponse>> {
  return requestApiResult(
    `/api/review-events/${encodeURIComponent(eventId)}/corrections`,
    createJsonRequest("POST", input),
  );
}

export function completeReviewBridgeTask(
  taskId: string,
  input: CompleteReviewBridgeInput,
): Promise<ApiResult<ReviewActionResponse>> {
  return requestApiResult(
    `/api/study-tasks/${encodeURIComponent(taskId)}/bridge-complete`,
    createJsonRequest("POST", input),
  );
}

export function deferReviewBridgeTask(
  taskId: string,
  input: DeferReviewBridgeInput,
): Promise<ApiResult<ReviewActionResponse>> {
  return requestApiResult(
    `/api/study-tasks/${encodeURIComponent(taskId)}/bridge-defer`,
    createJsonRequest("POST", input),
  );
}

export function abandonReviewBridgeTask(
  taskId: string,
): Promise<ApiResult<ReviewActionResponse>> {
  return requestApiResult(
    `/api/study-tasks/${encodeURIComponent(taskId)}/bridge-abandon`,
    { method: "POST" },
  );
}
