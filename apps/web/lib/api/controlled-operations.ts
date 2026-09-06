import { createJsonRequest, requestApiResult, type ApiResult } from "./client";

/**
 * Browser-safe projection of the controlled-operations protocol.
 *
 * This adapter intentionally contains no command, path, environment variable,
 * or worker implementation.  The browser can submit a typed intent and a
 * revision/hash/nonce binding only; execution remains outside the Web runtime.
 */
export type ControlledOperationCode =
  | "CHECK_RELEASE"
  | "BACKUP_PREVIEW"
  | "APPLY_RELEASE"
  | "ROLLBACK_RELEASE"
  | "MAINTENANCE_HOLD"
  | "DIAGNOSTIC_HEALTH";

export type ControlledOperationRisk = "READ_ONLY" | "HIGH_RISK";

export type ControlledOperationRequestStatus =
  | "PREVIEWED"
  | "CONFIRMATION_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "QUEUED"
  | "RUNNING"
  | "PAUSED"
  | "HELD"
  | "CANCEL_REQUESTED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export interface ControlledOperationDescriptorView {
  code: ControlledOperationCode;
  label: string;
  risk: ControlledOperationRisk;
  requiresApproval: boolean;
  requiresExpectedBefore: boolean;
  executionOwner: "WEB_PREVIEW" | "ROOT_AGENT";
}

// Naming aliases keep the browser DTO vocabulary aligned with the server
// service without importing its Node/Prisma module into the client bundle.
export type ControlledOperationDescriptor = ControlledOperationDescriptorView;

export type ControlledOperationParameters =
  | { operation: "CHECK_RELEASE"; tag: string | null }
  | { operation: "BACKUP_PREVIEW"; scope: "DATABASE" | "UPLOADS" | "FULL" }
  | { operation: "APPLY_RELEASE"; tag: string }
  | { operation: "ROLLBACK_RELEASE"; targetVersion: string }
  | { operation: "MAINTENANCE_HOLD"; reasonCode: "RELEASE" | "INCIDENT" | "RESTORE" | "CAPACITY" }
  | { operation: "DIAGNOSTIC_HEALTH"; includeCapacity: boolean };

export interface ControlledOperationIntentInput {
  operation: ControlledOperationParameters;
  expectedBeforeHash: string;
  idempotencyKey: string;
  requestedReason: string;
}

export interface ControlledOperationRequestBinding {
  expectedRevision: number;
  requestHash: string;
  nonce: string;
}

export interface ControlledOperationRequestView {
  id: string;
  operation: ControlledOperationParameters;
  risk: ControlledOperationRisk;
  requiresApproval: boolean;
  status: ControlledOperationRequestStatus;
  requestedByUserId: string;
  confirmedByUserId: string | null;
  approvedByUserId: string | null;
  requestedReason: string;
  expectedBeforeHash: string;
  idempotencyKey: string;
  intentHash: string;
  requestHash: string;
  nonce: string;
  requestedAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  approvedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  attempt: number;
  workerId: string | null;
  leaseExpiresAt: string | null;
  failureCode: string | null;
  retryable: boolean;
  holdReasonCode: string | null;
  resultCode: string | null;
  evidenceHash: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type ControlledOperationRequestDto = ControlledOperationRequestView;
export type ControlledOperationIntent = ControlledOperationIntentInput;

export interface ControlledOperationsResponse {
  error?: string;
  operations?: ControlledOperationDescriptorView[];
  requests?: ControlledOperationRequestView[];
  request?: ControlledOperationRequestView;
}

export function listControlledOperations(): Promise<ApiResult<ControlledOperationsResponse>> {
  return requestApiResult("/api/system/operations");
}

export function listControlledOperationRequests(options: {
  status?: ControlledOperationRequestStatus;
  limit?: number;
} = {}): Promise<ApiResult<ControlledOperationsResponse>> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const query = params.toString();
  return requestApiResult(`/api/system/operations/requests${query ? `?${query}` : ""}`);
}

export function getControlledOperationRequest(requestId: string): Promise<ApiResult<ControlledOperationsResponse>> {
  return requestApiResult(`/api/system/operations/requests/${encodeURIComponent(requestId)}`);
}

export function createControlledOperationRequest(
  input: ControlledOperationIntentInput,
): Promise<ApiResult<ControlledOperationsResponse>> {
  return requestApiResult(
    "/api/system/operations/requests",
    createJsonRequest("POST", input),
  );
}

export function confirmControlledOperationRequest(
  requestId: string,
  binding: ControlledOperationRequestBinding,
): Promise<ApiResult<ControlledOperationsResponse>> {
  return postRequestMutation(requestId, "confirm", binding);
}

export function approveControlledOperationRequest(
  requestId: string,
  binding: ControlledOperationRequestBinding,
): Promise<ApiResult<ControlledOperationsResponse>> {
  return postRequestMutation(requestId, "approve", binding);
}

export function cancelControlledOperationRequest(
  requestId: string,
  binding: ControlledOperationRequestBinding,
): Promise<ApiResult<ControlledOperationsResponse>> {
  return postRequestMutation(requestId, "cancel", binding);
}

export function holdControlledOperationRequest(
  requestId: string,
  binding: ControlledOperationRequestBinding & { reasonCode: "RELEASE" | "INCIDENT" | "RESTORE" | "CAPACITY" },
): Promise<ApiResult<ControlledOperationsResponse>> {
  return postRequestMutation(requestId, "hold", binding);
}

export function resumeControlledOperationRequest(
  requestId: string,
  binding: ControlledOperationRequestBinding,
): Promise<ApiResult<ControlledOperationsResponse>> {
  return postRequestMutation(requestId, "resume", binding);
}

export function retryControlledOperationRequest(
  requestId: string,
  binding: ControlledOperationRequestBinding,
): Promise<ApiResult<ControlledOperationsResponse>> {
  return postRequestMutation(requestId, "retry", binding);
}

function postRequestMutation(
  requestId: string,
  action: "confirm" | "approve" | "cancel" | "hold" | "resume" | "retry",
  binding: ControlledOperationRequestBinding | (ControlledOperationRequestBinding & { reasonCode: string }),
): Promise<ApiResult<ControlledOperationsResponse>> {
  return requestApiResult(
    `/api/system/operations/requests/${encodeURIComponent(requestId)}/${action}`,
    createJsonRequest("POST", binding),
  );
}
