import { createJsonRequest, requestApiResult, type ApiErrorEnvelope, type ApiResult } from "@/lib/api/client";
import type { NoteDto, NoteMasteryStatusDto } from "@/lib/contracts";

export type NoteKind = "GENERAL" | "CONCEPT" | "METHOD" | "EXAMPLE" | "JOURNAL" | "SUMMARY";

export interface CreateNoteInput {
  idempotencyKey: string;
  subjectId: string;
  syllabusNodeId?: string | null;
  relatedSyllabusNodeIds?: string[];
  taskId?: string | null;
  kind?: NoteKind;
  studyDate?: string | null;
  stableKey?: string | null;
  expectedRevision?: number;
  title: string;
  content: string;
  masteryStatus?: NoteMasteryStatusDto | null;
  nextReviewAt?: string | null;
}

export interface UpdateNoteInput {
  expectedRevision: number;
  subjectId?: string;
  syllabusNodeId?: string | null;
  relatedSyllabusNodeIds?: string[];
  taskId?: string | null;
  resourceIds?: string[];
  kind?: NoteKind;
  studyDate?: string | null;
  title?: string;
  content?: string;
  masteryStatus?: NoteMasteryStatusDto | null;
  nextReviewAt?: string | null;
}

export interface NoteRevisionCommandInput {
  expectedRevision: number;
}

export interface NoteMutationResponse extends ApiErrorEnvelope<NoteDto> {
  note?: NoteDto;
}

export function createNote(input: CreateNoteInput): Promise<ApiResult<NoteMutationResponse>> {
  return requestApiResult("/api/notes", createJsonRequest("POST", input));
}

export function updateNote(
  id: string,
  input: UpdateNoteInput,
): Promise<ApiResult<NoteMutationResponse>> {
  return requestApiResult(
    `/api/notes/${encodeURIComponent(id)}`,
    createJsonRequest("PATCH", input),
  );
}

export function archiveNote(
  id: string,
  input: NoteRevisionCommandInput,
): Promise<ApiResult<NoteMutationResponse>> {
  return runNoteRevisionCommand(id, "archive", input);
}

export function restoreNote(
  id: string,
  input: NoteRevisionCommandInput,
): Promise<ApiResult<NoteMutationResponse>> {
  return runNoteRevisionCommand(id, "restore", input);
}

function runNoteRevisionCommand(
  id: string,
  command: "archive" | "restore",
  input: NoteRevisionCommandInput,
): Promise<ApiResult<NoteMutationResponse>> {
  return requestApiResult(
    `/api/notes/${encodeURIComponent(id)}/${command}`,
    createJsonRequest("POST", input),
  );
}
