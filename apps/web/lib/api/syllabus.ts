import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type { SyllabusNodeDto } from "@/lib/contracts";

export interface SyllabusApiError {
  error?: string;
  latest?: SyllabusNodeDto;
  conflictFields?: string[];
  workbench?: string;
}

export interface SyllabusNodeResponse extends SyllabusApiError {
  node?: SyllabusNodeDto;
}

export interface SyllabusImportResponse extends SyllabusApiError {
  import?: {
    importedCount: number;
    ignoredLines: number[];
  };
}

export interface SyllabusRetestResponse extends SyllabusNodeResponse {
  retestId?: string;
}

export function createSyllabusNode(body: unknown): Promise<ApiResult<SyllabusNodeResponse>> {
  return requestApiResult("/api/syllabus/nodes", createJsonRequest("POST", body));
}

export function importSyllabusMarkdown(body: unknown): Promise<ApiResult<SyllabusImportResponse>> {
  return requestApiResult("/api/syllabus/import-markdown", createJsonRequest("POST", body));
}

export function updateSyllabusNode(
  id: string,
  body: unknown,
): Promise<ApiResult<SyllabusNodeResponse>> {
  return requestApiResult(
    `/api/syllabus/nodes/${encodeURIComponent(id)}`,
    createJsonRequest("PATCH", body),
  );
}

export function setSyllabusNodeArchiveState(
  id: string,
  intent: "archive" | "restore",
  expectedRevision: number,
): Promise<ApiResult<SyllabusNodeResponse>> {
  return requestApiResult(
    `/api/syllabus/nodes/${encodeURIComponent(id)}/${intent}`,
    createJsonRequest("POST", { expectedRevision }),
  );
}

export function addSyllabusMasteryEvidence(
  id: string,
  body: unknown,
): Promise<ApiResult<SyllabusNodeResponse>> {
  return requestApiResult(
    `/api/syllabus/nodes/${encodeURIComponent(id)}/mastery-evidence`,
    createJsonRequest("POST", body),
  );
}

export function addSyllabusMasteryRetest(
  id: string,
  body: unknown,
): Promise<ApiResult<SyllabusRetestResponse>> {
  return requestApiResult(
    `/api/syllabus/nodes/${encodeURIComponent(id)}/mastery-retests`,
    createJsonRequest("POST", body),
  );
}
