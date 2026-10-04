import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type { StudyResourceDto } from "@/lib/contracts";

export interface StudyResourceResponse {
  resource?: StudyResourceDto;
  latest?: StudyResourceDto;
  conflictFields?: string[];
  error?: string;
  workbench?: string;
}

export interface CreateLinkStudyResourceInput {
  title: string;
  url: string;
  subjectId?: string | null;
  category?: string;
  stableKey?: string;
  tags?: string[];
}

export function updateStudyResource(
  id: string,
  body: unknown,
): Promise<ApiResult<StudyResourceResponse>> {
  return requestApiResult(
    `/api/study-resources/${encodeURIComponent(id)}`,
    createJsonRequest("PATCH", body),
  );
}

export function setStudyResourceArchiveState(
  id: string,
  action: "archive" | "restore",
  expectedRevision: number,
): Promise<ApiResult<StudyResourceResponse>> {
  return requestApiResult(
    `/api/study-resources/${encodeURIComponent(id)}/${action}`,
    createJsonRequest("POST", { expectedRevision }),
  );
}

export function createLinkStudyResource(body: CreateLinkStudyResourceInput): Promise<ApiResult<StudyResourceResponse>> {
  return requestApiResult("/api/study-resources/links", createJsonRequest("POST", body));
}
