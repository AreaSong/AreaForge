import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type {
  StudySessionDto,
  StudySessionEvidenceReceiptDto,
  StudySessionEvidenceTypeDto,
} from "@/lib/contracts";

export interface StudySessionApiResponse {
  session?: StudySessionDto | null;
  latest?: StudySessionDto | null;
  receipt?: StudySessionEvidenceReceiptDto;
  error?: string;
  conflictFields?: string[];
  workbench?: string;
}

export function getActiveStudySession(
  headers?: HeadersInit,
): Promise<ApiResult<StudySessionApiResponse>> {
  return requestApiResult("/api/study-sessions/active", {
    cache: "no-store",
    headers,
  });
}

export function startStudySession(
  body: unknown,
  headers?: HeadersInit,
): Promise<ApiResult<StudySessionApiResponse>> {
  return requestApiResult(
    "/api/study-sessions/start",
    createJsonRequest("POST", body, { headers }),
  );
}

export function postStudySessionCommand(
  sessionId: string,
  command: "pause" | "resume" | "end" | "context" | "cancel",
  body: unknown,
  headers?: HeadersInit,
): Promise<ApiResult<StudySessionApiResponse>> {
  return requestApiResult(
    `/api/study-sessions/${encodeURIComponent(sessionId)}/${command}`,
    createJsonRequest("POST", body, { headers }),
  );
}

export function heartbeatStudySession(
  sessionId: string,
  body: unknown,
  headers?: HeadersInit,
): Promise<ApiResult<StudySessionApiResponse>> {
  return requestApiResult(
    `/api/study-sessions/${encodeURIComponent(sessionId)}/heartbeat`,
    createJsonRequest("POST", body, { headers, cache: "no-store" }),
  );
}

export function linkStudySessionEvidence(
  sessionId: string,
  body: {
    idempotencyKey: string;
    expectedCloseoutVersion: number;
    evidenceType: StudySessionEvidenceTypeDto;
    evidenceId: string;
  },
  headers?: HeadersInit,
): Promise<ApiResult<StudySessionApiResponse>> {
  return requestApiResult(
    `/api/study-sessions/${encodeURIComponent(sessionId)}/evidence`,
    createJsonRequest("POST", body, { headers }),
  );
}
