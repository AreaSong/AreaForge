import {
  createJsonRequest,
  requestApiResult,
  type ApiResult,
} from "@/lib/api/client";
import type { KnowledgeCanvasQueryDto } from "@/lib/contracts";
import type {
  KnowledgeCanvasNodeLayoutInput,
  KnowledgeCanvasViewportInput,
} from "@areaforge/core";

export interface KnowledgeCanvasQueryInput {
  workspaceId: string;
  depth: number;
  focus?: string;
  cursor?: string | null;
  q?: string;
  entityType?: string;
  subjectId?: string;
  status: "active" | "all";
}

export interface KnowledgeCanvasQueryResponse {
  canvas?: KnowledgeCanvasQueryDto;
  error?: string;
}

export interface KnowledgeCanvasLayoutMutationResponse {
  error?: string;
  layout?: KnowledgeCanvasQueryDto["layout"];
  latest?: Partial<KnowledgeCanvasQueryDto["layout"]>;
  conflictFields?: string[];
}

export interface KnowledgeCanvasLayoutSaveInput extends KnowledgeCanvasViewportInput {
  workspaceId: string;
  expectedRevision: number;
  nodes: KnowledgeCanvasNodeLayoutInput[];
}

export interface KnowledgeCanvasLayoutResetInput {
  workspaceId: string;
  expectedRevision: number;
}

export function loadKnowledgeCanvas(
  input: KnowledgeCanvasQueryInput,
): Promise<ApiResult<KnowledgeCanvasQueryResponse>> {
  const search = new URLSearchParams({
    workspaceId: input.workspaceId,
    depth: String(input.depth),
    status: input.status,
  });
  setOptionalSearchParam(search, "focus", input.focus);
  setOptionalSearchParam(search, "cursor", input.cursor);
  setOptionalSearchParam(search, "q", input.q);
  setOptionalSearchParam(search, "entityType", input.entityType);
  setOptionalSearchParam(search, "subjectId", input.subjectId);
  return requestApiResult(`/api/knowledge-canvas?${search.toString()}`, { cache: "no-store" });
}

export function saveKnowledgeCanvasLayout(
  input: KnowledgeCanvasLayoutSaveInput,
): Promise<ApiResult<KnowledgeCanvasLayoutMutationResponse>> {
  return requestApiResult(
    "/api/knowledge-canvas/layout",
    createJsonRequest("PUT", input),
  );
}

export function resetKnowledgeCanvasLayout(
  input: KnowledgeCanvasLayoutResetInput,
): Promise<ApiResult<KnowledgeCanvasLayoutMutationResponse>> {
  return requestApiResult(
    "/api/knowledge-canvas/layout",
    createJsonRequest("DELETE", input),
  );
}

function setOptionalSearchParam(
  search: URLSearchParams,
  key: string,
  value: string | null | undefined,
): void {
  if (value) search.set(key, value);
}
