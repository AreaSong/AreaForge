import {
  createJsonRequest,
  requestApiBlob,
  requestApiResult,
  type ApiErrorEnvelope,
  type ApiResult,
} from "@/lib/api/client";
import type {
  LearningTreeConfirmResultDto,
  LearningTreeImportBatchSummaryDto,
  LearningTreePreviewDto,
} from "@/lib/contracts";

export interface LearningTreeConflictSnapshot {
  state: string;
}

export type LearningTreeApiError = ApiErrorEnvelope<LearningTreeConflictSnapshot>;

export interface LearningTreePreviewResponse extends LearningTreeApiError {
  preview?: LearningTreePreviewDto;
}

export interface LearningTreeConfirmResponse extends LearningTreeApiError {
  result?: LearningTreeConfirmResultDto;
}

export interface LearningTreeImportResponse extends LearningTreeApiError {
  import?: LearningTreeImportBatchSummaryDto;
}

export interface LearningTreeExportPreview {
  scope: "global" | "subject" | "branch";
  objectCount: number;
  cardBodyCount: number;
  planTitleCount: number;
  externalHosts: string[];
  bytes: number;
  sourceSha256: string;
  exportToken: string;
  exportExpiresAt: string;
}

export interface LearningTreeExportPreviewResponse extends LearningTreeApiError {
  preview?: LearningTreeExportPreview;
}

export function previewLearningTreeImport(body: unknown): Promise<ApiResult<LearningTreePreviewResponse>> {
  return requestApiResult(
    "/api/learning-tree/imports/preview",
    createJsonRequest("POST", body),
  );
}

export function confirmLearningTreeImport(body: unknown): Promise<ApiResult<LearningTreeConfirmResponse>> {
  return requestApiResult(
    "/api/learning-tree/imports/confirm",
    createJsonRequest("POST", body),
  );
}

export function previewLearningTreeExport(input: {
  scope: "global" | "subject" | "branch";
  subjectKey?: string;
  rootNodeKey?: string;
}): Promise<ApiResult<LearningTreeExportPreviewResponse>> {
  const search = new URLSearchParams({ scope: input.scope, preview: "1" });
  if (input.subjectKey) search.set("subjectKey", input.subjectKey);
  if (input.rootNodeKey) search.set("rootNodeKey", input.rootNodeKey);
  return requestApiResult(`/api/learning-tree/export?${search.toString()}`, { cache: "no-store" });
}

/** File-body endpoint: the adapter owns fetch while the component owns the download gesture. */
export interface LearningTreeExportDownloadResult {
  ok: boolean;
  status: number;
  headers: Headers;
  blob: Blob | null;
  error: LearningTreeApiError | null;
}

export async function downloadLearningTreeExport(body: unknown): Promise<LearningTreeExportDownloadResult> {
  const result = await requestApiBlob<LearningTreeApiError>(
    "/api/learning-tree/export",
    createJsonRequest("POST", body),
  );
  return {
    ok: result.ok,
    status: result.status,
    headers: result.headers,
    blob: result.blob,
    error: result.body,
  };
}

export function getLearningTreeImport(id: string): Promise<ApiResult<LearningTreeImportResponse>> {
  return requestApiResult(`/api/learning-tree/imports/${encodeURIComponent(id)}`, { cache: "no-store" });
}

export function setLearningTreeImportArchived(
  id: string,
  archived: boolean,
): Promise<ApiResult<LearningTreeImportResponse>> {
  return requestApiResult(
    `/api/learning-tree/imports/${encodeURIComponent(id)}`,
    createJsonRequest("PATCH", { archived }),
  );
}
