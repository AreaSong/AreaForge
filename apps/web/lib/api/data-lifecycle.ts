import { createJsonRequest, requestApiResult, type ApiResult } from "./client";

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

export function redeemExportDownloadGrant(token: string): Promise<ApiResult<DataLifecycleResponse>> {
  return requestApiResult(
    "/api/system/data-jobs/download-grants/redeem",
    createJsonRequest("POST", { token }),
  );
}
