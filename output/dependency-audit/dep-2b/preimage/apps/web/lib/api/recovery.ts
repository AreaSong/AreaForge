import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type { RecoveryStateDto, StudyTaskDto, SubjectDto } from "@/lib/contracts";

export interface RecoveryOptionsResponse {
  subjects?: SubjectDto[];
  tasks?: StudyTaskDto[];
  error?: string;
}

export interface ActiveSessionResponse {
  session?: { id?: string } | null;
  error?: string;
}

export interface RecoverySessionResponse {
  session?: { id?: string };
  latest?: { id?: string };
  error?: string;
}

export interface RecoveryStateResponse {
  recoveryState?: RecoveryStateDto;
  error?: string;
}

export function listRecoverySubjects(): Promise<ApiResult<RecoveryOptionsResponse>> {
  return requestApiResult("/api/subjects", { cache: "no-store" });
}

export function listRecoveryTasks(): Promise<ApiResult<RecoveryOptionsResponse>> {
  return requestApiResult("/api/tasks", { cache: "no-store" });
}

export function getActiveStudySession(): Promise<ApiResult<ActiveSessionResponse>> {
  return requestApiResult("/api/study-sessions/active", { cache: "no-store" });
}

export function createRecoveryTask(body: unknown): Promise<ApiResult<{ task?: { id: string }; error?: string }>> {
  return requestApiResult("/api/tasks", createJsonRequest("POST", body));
}

export function startRecoverySession(
  body: unknown,
  headers?: HeadersInit,
): Promise<ApiResult<RecoverySessionResponse>> {
  return requestApiResult(
    "/api/study-sessions/start",
    createJsonRequest("POST", body, { headers }),
  );
}

export function startManualRecovery(): Promise<ApiResult<RecoveryStateResponse>> {
  return requestApiResult("/api/recovery-states/manual", createJsonRequest("POST", {}));
}

export function completeRecoveryState(
  id: string,
  exitCondition: string,
): Promise<ApiResult<RecoveryStateResponse>> {
  return requestApiResult(
    `/api/recovery-states/${encodeURIComponent(id)}/complete`,
    createJsonRequest("POST", { exitCondition }),
  );
}

export function cancelRecoveryState(
  id: string,
  exitCondition: string,
): Promise<ApiResult<RecoveryStateResponse>> {
  return requestApiResult(
    `/api/recovery-states/${encodeURIComponent(id)}/cancel`,
    createJsonRequest("POST", { exitCondition }),
  );
}

export function restartRecoveryState(
  id: string,
  expectedRevision: number,
): Promise<ApiResult<RecoveryStateResponse>> {
  return requestApiResult(
    `/api/recovery/${encodeURIComponent(id)}/restart`,
    createJsonRequest("POST", { expectedRevision }),
  );
}
