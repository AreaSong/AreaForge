import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type {
  KnowledgeRetestDetailDto,
  KnowledgeRetestResultDto,
} from "@/lib/contracts";

export interface CreateKnowledgeRetestInput {
  idempotencyKey: string;
  title: string;
  method: string;
  scheduledAt?: string | null;
  knowledgePointIds: string[];
}

export interface KnowledgeRetestCommandInput {
  idempotencyKey: string;
  expectedRevision: number;
}

export interface SubmitKnowledgeRetestInput extends KnowledgeRetestCommandInput {
  points: Array<{
    pointId: string;
    result: KnowledgeRetestResultDto;
    score?: number | null;
    understanding?: number | null;
    note?: string | null;
  }>;
  summary: string;
  reviewText: string;
}

export interface KnowledgeRetestMutationResponse {
  retest?: KnowledgeRetestDetailDto;
  latest?: KnowledgeRetestDetailDto;
  error?: string;
  conflictFields?: string[];
  workbench?: string;
}

export function createKnowledgeRetest(
  input: CreateKnowledgeRetestInput,
): Promise<ApiResult<KnowledgeRetestMutationResponse>> {
  return requestApiResult(
    "/api/knowledge-retests",
    createJsonRequest("POST", input),
  );
}

export function startKnowledgeRetest(
  id: string,
  input: KnowledgeRetestCommandInput,
): Promise<ApiResult<KnowledgeRetestMutationResponse>> {
  return runKnowledgeRetestCommand(id, "start", input);
}

export function submitKnowledgeRetest(
  id: string,
  input: SubmitKnowledgeRetestInput,
): Promise<ApiResult<KnowledgeRetestMutationResponse>> {
  return runKnowledgeRetestCommand(id, "submit", input);
}

export function confirmKnowledgeRetest(
  id: string,
  input: KnowledgeRetestCommandInput,
): Promise<ApiResult<KnowledgeRetestMutationResponse>> {
  return runKnowledgeRetestCommand(id, "confirm", input);
}

function runKnowledgeRetestCommand(
  id: string,
  command: "start" | "submit" | "confirm",
  input: KnowledgeRetestCommandInput | SubmitKnowledgeRetestInput,
): Promise<ApiResult<KnowledgeRetestMutationResponse>> {
  return requestApiResult(
    `/api/knowledge-retests/${encodeURIComponent(id)}/${command}`,
    createJsonRequest("POST", input),
  );
}
