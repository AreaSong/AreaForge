import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type {
  KnowledgeMasteryStateDto,
  KnowledgePointDetailDto,
  KnowledgePointDto,
} from "@/lib/contracts";

export interface CreateKnowledgePointInput {
  idempotencyKey: string;
  subjectId: string;
  primaryGroupId?: string | null;
  stableKey?: string;
  title: string;
  boundary?: string | null;
  relatedSubjectIds?: string[];
}

export interface UpdateKnowledgePointInput {
  expectedRevision: number;
  title?: string;
  boundary?: string | null;
  primaryGroupId?: string | null;
  masteryState?: KnowledgeMasteryStateDto;
  nextRetestAt?: string | null;
}

export interface CreateKnowledgePointResponse {
  knowledgePoint?: KnowledgePointDto;
  error?: string;
  conflictFields?: string[];
  workbench?: string;
}

export interface UpdateKnowledgePointResponse {
  knowledgePoint?: KnowledgePointDetailDto;
  latest?: KnowledgePointDetailDto;
  error?: string;
  conflictFields?: string[];
  workbench?: string;
}

export function createKnowledgePoint(
  input: CreateKnowledgePointInput,
): Promise<ApiResult<CreateKnowledgePointResponse>> {
  return requestApiResult(
    "/api/knowledge-points",
    createJsonRequest("POST", input),
  );
}

export function updateKnowledgePoint(
  id: string,
  input: UpdateKnowledgePointInput,
): Promise<ApiResult<UpdateKnowledgePointResponse>> {
  return requestApiResult(
    `/api/knowledge-points/${encodeURIComponent(id)}`,
    createJsonRequest("PATCH", input),
  );
}
