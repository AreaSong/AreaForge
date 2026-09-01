import { createJsonRequest, requestApiResult, type ApiErrorEnvelope, type ApiResult } from "@/lib/api/client";
import type { AttachmentDto, StagingUploadResult, StudyResourceDto } from "@/lib/contracts";

export type UploadResolutionDecision = "reuse" | "copy" | "skip";

export interface ResolveUploadRequest {
  attachmentId: string;
  decision: UploadResolutionDecision;
  reuseResourceId?: string;
  title: string;
  subjectId: string | null;
  category: string;
  tags: string[];
}

export interface UploadResolutionLatest {
  attachmentId: string;
  decision: UploadResolutionDecision;
  resourceId: string | null;
  resource: StudyResourceDto | null;
  request: ResolveUploadRequest | null;
}

export interface StagingUploadsResponse {
  items?: StagingUploadResult[];
  error?: string;
}

export interface StageUploadBatchResponse {
  items?: Array<{
    index: number;
    originalName: string;
    staging: StagingUploadResult | null;
    error: string | null;
  }>;
  error?: string;
}

export interface ResolveUploadResponse extends ApiErrorEnvelope<UploadResolutionLatest> {
  resource?: StudyResourceDto;
  skipped?: boolean;
}

export function listStagingUploads(): Promise<ApiResult<StagingUploadsResponse>> {
  return requestApiResult("/api/study-resources/uploads/staging", { cache: "no-store" });
}

export function stageUploads(
  body: FormData,
  idempotencyKey: string,
): Promise<ApiResult<StageUploadBatchResponse>> {
  return requestApiResult("/api/study-resources/uploads/staging", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body,
  });
}

export function resolveStagedUpload(
  body: ResolveUploadRequest,
): Promise<ApiResult<ResolveUploadResponse>> {
  return requestApiResult(
    "/api/study-resources/uploads/resolve",
    createJsonRequest("POST", body),
  );
}

export function uploadNoteAttachment(
  noteId: string,
  body: FormData,
  idempotencyKey: string,
): Promise<ApiResult<{ attachment?: AttachmentDto; error?: string }>> {
  return requestApiResult(`/api/notes/${encodeURIComponent(noteId)}/attachments`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body,
  });
}
