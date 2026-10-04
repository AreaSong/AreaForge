import { createJsonRequest, requestApiBlob, requestApiResult, type ApiBlobResult, type ApiResult } from "./client";

export type DataJobKind = "EXPORT" | "DELETE";
export type DataJobScope = "ACCOUNT" | "WORKSPACE";
export type DataJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "PAUSED"
  | "CANCEL_REQUESTED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export interface DataExportPreviewEntryView {
  kind: string;
  id: string;
  sha256: string;
  omittedFieldCount: number;
}

export interface DataExportPreviewView {
  previewVersion: "data-lifecycle-preview-v1";
  scope: DataJobScope;
  generatedAt: string;
  manifestSha256: string;
  entries: DataExportPreviewEntryView[];
  recordCount: number;
  attachmentCount: number;
  omittedFieldCount: number;
  packageStatus: "NOT_CREATED";
  archiveStatus: "NOT_WRITTEN";
}

export interface DataDeletePreviewView {
  previewVersion: "data-lifecycle-preview-v1";
  scope: DataJobScope;
  workspaceIds: string[];
  counts: Record<string, number>;
  totalObjects: number;
  scopeHash: string;
  generatedAt: string;
  cooldownUntil: string;
  physicalDeletionSupported: false;
  executionState: "PREVIEW_ONLY";
  blockers: string[];
  rankingBlockerCount?: number;
  rankingParticipationCount?: number;
  rankingProjectionCount?: number;
}

export interface DataJobView {
  id: string;
  kind: DataJobKind;
  scope: DataJobScope;
  status: DataJobStatus;
  progress: number;
  attempt: number;
  queueVersion?: number;
  nextAttemptAt?: string | null;
  deadLetteredAt?: string | null;
  pauseRequested?: boolean;
  downloadable?: boolean;
  exportState?: "PREVIEW_ONLY" | "NOT_READY" | "READY" | "EXPIRED" | "UNAVAILABLE" | "DISABLED";
  exportSummary?: { fileName: string; sizeBytes: string; recordCount: number; attachmentCount: number } | null;
  revision: number;
  errorCode: string | null;
  retryable: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  preview: DataExportPreviewView | DataDeletePreviewView | null;
}

export interface DataDownloadGrantView {
  id: string;
  jobId: string;
  token: string;
  expiresAt: string;
}

export interface RedeemedDownloadView {
  packageId: string;
  jobId: string;
  fileName: string;
  contentType: string;
  sizeBytes: string;
  archiveSha256: string;
  manifestSha256: string;
  consumedAt: string;
}

export interface DataLifecycleResponse {
  error?: string;
  jobs?: DataJobView[];
  job?: DataJobView;
  preview?: DataExportPreviewView | DataDeletePreviewView;
  grant?: DataDownloadGrantView;
  download?: RedeemedDownloadView;
  revokedCount?: number;
}

export function listDataLifecycleJobs(): Promise<ApiResult<DataLifecycleResponse>> {
  return requestApiResult("/api/system/data-jobs");
}

export function getDataLifecycleJob(jobId: string): Promise<ApiResult<DataLifecycleResponse>> {
  return requestApiResult(`/api/system/data-jobs/${encodeURIComponent(jobId)}`);
}

export function previewDataLifecycle(
  kind: DataJobKind,
  scope: DataJobScope,
  workspaceId?: string,
): Promise<ApiResult<DataLifecycleResponse>> {
  return requestApiResult(
    "/api/system/data-jobs/preview",
    createJsonRequest("POST", { kind, scope, ...(workspaceId ? { workspaceId } : {}) }),
  );
}

export function requestDataLifecycleJob(input: {
  kind: DataJobKind;
  scope: DataJobScope;
  workspaceId?: string;
  idempotencyKey: string;
}): Promise<ApiResult<DataLifecycleResponse>> {
  return requestApiResult("/api/system/data-jobs", createJsonRequest("POST", input));
}

export function cancelDataLifecycleJob(
  jobId: string,
  expectedRevision: number,
): Promise<ApiResult<DataLifecycleResponse>> {
  return requestApiResult(
    `/api/system/data-jobs/${encodeURIComponent(jobId)}`,
    createJsonRequest("PATCH", { action: "cancel", expectedRevision }),
  );
}

export function retryDataLifecycleJob(
  jobId: string,
  expectedRevision: number,
): Promise<ApiResult<DataLifecycleResponse>> {
  return requestApiResult(
    `/api/system/data-jobs/${encodeURIComponent(jobId)}`,
    createJsonRequest("PATCH", { action: "retry", expectedRevision }),
  );
}

export function createExportDownloadGrant(jobId: string): Promise<ApiResult<DataLifecycleResponse>> {
  return requestApiResult(
    `/api/system/data-jobs/${encodeURIComponent(jobId)}/download-grants`,
    createJsonRequest("POST", {}),
  );
}

export function revokeExportDownloadGrants(jobId: string): Promise<ApiResult<DataLifecycleResponse>> {
  return requestApiResult(`/api/system/data-jobs/${encodeURIComponent(jobId)}/download-grants`, {
    method: "DELETE",
  });
}

export function pauseDataLifecycleJob(jobId: string, expectedRevision: number): Promise<ApiResult<DataLifecycleResponse>> {
  return requestApiResult(`/api/system/data-jobs/${encodeURIComponent(jobId)}`, createJsonRequest("PATCH", { action: "pause", expectedRevision }));
}

export function resumeDataLifecycleJob(jobId: string, expectedRevision: number): Promise<ApiResult<DataLifecycleResponse>> {
  return requestApiResult(`/api/system/data-jobs/${encodeURIComponent(jobId)}`, createJsonRequest("PATCH", { action: "resume", expectedRevision }));
}

export interface DataExportDownloadResult extends ApiBlobResult<DataLifecycleResponse> { fileName: string | null }
export async function redeemExportDownloadGrant(token: string, signal?: AbortSignal): Promise<DataExportDownloadResult> {
  try {
    const result = await requestApiBlob<DataLifecycleResponse>("/api/system/data-jobs/download-grants/redeem", createJsonRequest("POST", { token }, { signal }));
    if (!result.ok || !result.blob) return { ...result, fileName: null };
    const length = result.headers.get("content-length");
    const magic = new Uint8Array(await result.blob.slice(0, 4).arrayBuffer());
    if (result.headers.get("content-type")?.split(";")[0]?.trim() !== "application/zip" || result.blob.size > 512 * 1024 * 1024
      || (length !== null && Number(length) !== result.blob.size) || magic.join(",") !== "80,75,3,4") {
      return { ...result, ok: false, blob: null, body: { error: "DATA_EXPORT_DOWNLOAD_INVALID" }, fileName: null };
    }
    const disposition = result.headers.get("content-disposition") ?? "";
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const proposed = encoded ? decodeURIComponent(encoded) : /filename="([^"]+)"/i.exec(disposition)?.[1];
    return { ...result, fileName: proposed && /^areaforge-(?:account|workspace)-[A-Za-z0-9_-]+\.zip$/.test(proposed) ? proposed : "areaforge-export.zip" };
  } catch {
    return { ok: false, status: 0, headers: new Headers(), blob: null, body: null, fileName: null };
  }
}
