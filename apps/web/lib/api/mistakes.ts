import { createJsonRequest, requestApiResult, type ApiErrorEnvelope, type ApiResult } from "@/lib/api/client";
import type { MistakeAttemptDto, MistakeCauseDto, MistakeDto } from "@/lib/contracts";

export interface CreateMistakeInput {
  idempotencyKey: string;
  subjectId: string;
  syllabusNodeId?: string | null;
  title: string;
  questionText: string;
  source?: string | null;
  cause: MistakeCauseDto;
  causeNote?: string | null;
  correctAnswer?: string | null;
  correctIdea: string | null;
  nextReviewAt?: string | null;
  simulationLossItemId?: string | null;
}

export interface UpdateMistakeInput {
  expectedUpdatedAt: string;
  subjectId?: string;
  syllabusNodeId?: string | null;
  title?: string;
  questionText?: string;
  source?: string | null;
  cause?: MistakeCauseDto;
  causeNote?: string | null;
  correctAnswer?: string | null;
  correctIdea?: string | null;
  nextReviewAt?: string | null;
}

export interface MistakeAttemptInput {
  idempotencyKey: string;
  answerMode: "TEXT" | "PAPER_OR_ORAL";
  answerText?: string | null;
  result: "PASSED" | "PARTIAL" | "FAILED";
  durationSeconds?: number | null;
  note?: string | null;
}

export interface MistakeArchiveCommandInput {
  expectedUpdatedAt: string;
}

export interface MistakeMutationResponse extends ApiErrorEnvelope<MistakeDto> {
  mistake?: MistakeDto;
}

export interface MistakeAttemptResponse {
  attempt?: MistakeAttemptDto;
  error?: string;
  workbench?: string;
}

export interface UpdateMistakeLinksInput {
  expectedUpdatedAt: string;
  noteIds: string[];
  resourceIds: string[];
}

export interface UpdateMistakeLinksResponse {
  mistake?: MistakeDto;
  latest?: MistakeDto;
  error?: string;
  conflictFields?: string[];
  workbench?: string;
}

export function createMistake(
  input: CreateMistakeInput,
): Promise<ApiResult<MistakeMutationResponse>> {
  return requestApiResult("/api/mistakes", createJsonRequest("POST", input));
}

export function updateMistake(
  id: string,
  input: UpdateMistakeInput,
): Promise<ApiResult<MistakeMutationResponse>> {
  return requestApiResult(
    `/api/mistakes/${encodeURIComponent(id)}`,
    createJsonRequest("PATCH", input),
  );
}

export function createMistakeAttempt(
  id: string,
  input: MistakeAttemptInput,
): Promise<ApiResult<MistakeAttemptResponse>> {
  return requestApiResult(
    `/api/mistakes/${encodeURIComponent(id)}/attempts`,
    createJsonRequest("POST", input),
  );
}

export function archiveMistake(
  id: string,
  input: MistakeArchiveCommandInput,
): Promise<ApiResult<MistakeMutationResponse>> {
  return runMistakeArchiveCommand(id, "archive", input);
}

export function restoreMistake(
  id: string,
  input: MistakeArchiveCommandInput,
): Promise<ApiResult<MistakeMutationResponse>> {
  return runMistakeArchiveCommand(id, "restore", input);
}

export function updateMistakeLinks(
  id: string,
  input: UpdateMistakeLinksInput,
): Promise<ApiResult<UpdateMistakeLinksResponse>> {
  return requestApiResult(
    `/api/mistakes/${encodeURIComponent(id)}/links`,
    createJsonRequest("PATCH", input),
  );
}

function runMistakeArchiveCommand(
  id: string,
  command: "archive" | "restore",
  input: MistakeArchiveCommandInput,
): Promise<ApiResult<MistakeMutationResponse>> {
  return requestApiResult(
    `/api/mistakes/${encodeURIComponent(id)}/${command}`,
    createJsonRequest("POST", input),
  );
}
