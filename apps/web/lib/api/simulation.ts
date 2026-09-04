import { createJsonRequest, requestApiResult, type ApiErrorEnvelope, type ApiResult } from "@/lib/api/client";
import type {
  MotivationVaultDto,
  SimulationExamDto,
  SimulationLossItemDto,
  StageAdjustmentDraftRecordDto,
  StagePlanDto,
} from "@/lib/contracts";

export interface SimulationApiError extends ApiErrorEnvelope<SimulationExamDto> {
  details?: {
    formErrors?: string[];
    fieldErrors?: Record<string, string[]>;
  };
}

export interface SimulationExamResponse extends SimulationApiError {
  exam?: SimulationExamDto;
}

export interface CreateSimulationExamInput {
  idempotencyKey: string;
  name: string;
  examDate?: string;
  isFirstSynchronized?: boolean;
  targetDurationMinutes?: number;
  targetScore?: number;
}

export interface SimulationSubjectResultInput {
  subjectId: string;
  expectedRevision?: number;
  paperFullScore: number | null;
  targetScore: number | null;
  actualScore: number | null;
  durationMinutes?: number | null;
  blankQuestionCount: number;
  lossReasons: string[];
  summary?: string;
  lossItems?: Array<{
    reason: SimulationLossItemDto["reason"];
    syllabusNodeId?: string | null;
    lostScore: number;
    note?: string | null;
  }>;
}

export interface SaveSimulationExamResultsInput {
  expectedRevision: number;
  targetDurationMinutes?: number;
  actualDurationMinutes?: number;
  targetScore?: number;
  actualScore?: number;
  blankQuestionCount?: number;
  lossReasons: string[];
  mindset?: string;
  summary: string;
  reviewText?: string;
  subjectResults: SimulationSubjectResultInput[];
}

export interface CreateSimulationLossItemInput {
  idempotencyKey: string;
  expectedExamRevision: number;
  expectedSubjectResultRevision: number;
  reason: SimulationLossItemDto["reason"];
  syllabusNodeId?: string | null;
  lostScore: number;
  note?: string | null;
}

export interface UpdateSimulationLossItemInput {
  expectedRevision: number;
  expectedExamRevision: number;
  expectedSubjectResultRevision: number;
  reason?: SimulationLossItemDto["reason"];
  syllabusNodeId?: string | null;
  lostScore?: number;
  note?: string | null;
}

export interface SimulationLossItemRevisionInput {
  expectedRevision: number;
  expectedExamRevision: number;
  expectedSubjectResultRevision: number;
}

export interface SimulationLossItemMutationResponse extends SimulationApiError {
  lossItem?: SimulationLossItemDto;
  versions?: {
    subjectResultRevision: number;
    examRevision: number;
    examStatus: SimulationExamDto["status"];
  };
}

export interface SimulationRemediationResponse extends SimulationApiError {
  created?: number;
  reused?: number;
}

export interface SimulationDiaryResponse extends SimulationApiError {
  vault?: MotivationVaultDto;
}

export interface SimulationStagePlanResponse extends SimulationApiError {
  plan?: StagePlanDto;
}

export interface SimulationStageDraftResponse extends SimulationApiError {
  draft?: StageAdjustmentDraftRecordDto;
}

export function createSimulationExam(
  input: CreateSimulationExamInput,
): Promise<ApiResult<SimulationExamResponse>> {
  return requestApiResult("/api/simulation/exams", createJsonRequest("POST", input));
}

export function getSimulationExam(
  examId: string,
): Promise<ApiResult<SimulationExamResponse>> {
  return requestApiResult(
    `/api/simulation-exams/${encodeURIComponent(examId)}`,
    { cache: "no-store" },
  );
}

export function updateSimulationExamResults(
  examId: string,
  input: SaveSimulationExamResultsInput,
): Promise<ApiResult<SimulationExamResponse>> {
  return requestApiResult(
    `/api/simulation-exams/${encodeURIComponent(examId)}`,
    createJsonRequest("PATCH", input),
  );
}

export function submitSimulationExamResults(
  examId: string,
  input: SaveSimulationExamResultsInput,
): Promise<ApiResult<SimulationExamResponse>> {
  return requestApiResult(
    `/api/simulation/exams/${encodeURIComponent(examId)}/results`,
    createJsonRequest("POST", input),
  );
}

export function startSimulationExam(
  examId: string,
  input: { idempotencyKey: string; expectedRevision: number },
): Promise<ApiResult<SimulationExamResponse>> {
  return requestApiResult(
    `/api/simulation-exams/${encodeURIComponent(examId)}/start`,
    createJsonRequest("POST", input),
  );
}

export function createSimulationLossItem(
  subjectResultId: string,
  input: CreateSimulationLossItemInput,
): Promise<ApiResult<SimulationLossItemMutationResponse>> {
  return requestApiResult(
    `/api/simulation/subject-results/${encodeURIComponent(subjectResultId)}/loss-items`,
    createJsonRequest("POST", input),
  );
}

export function updateSimulationLossItem(
  subjectResultId: string,
  lossItemId: string,
  input: UpdateSimulationLossItemInput,
): Promise<ApiResult<SimulationLossItemMutationResponse>> {
  return requestApiResult(
    `/api/simulation/subject-results/${encodeURIComponent(subjectResultId)}/loss-items/${encodeURIComponent(lossItemId)}`,
    createJsonRequest("PATCH", input),
  );
}

export function setSimulationLossItemArchiveState(
  subjectResultId: string,
  lossItemId: string,
  action: "archive" | "restore",
  input: SimulationLossItemRevisionInput,
): Promise<ApiResult<SimulationLossItemMutationResponse>> {
  return requestApiResult(
    `/api/simulation/subject-results/${encodeURIComponent(subjectResultId)}/loss-items/${encodeURIComponent(lossItemId)}/${action}`,
    createJsonRequest("POST", input),
  );
}

export function addSimulationRemediationsToInbox(
  examId: string,
  selections: Array<{ originKey: string; originVersion: number }>,
): Promise<ApiResult<SimulationRemediationResponse>> {
  return requestApiResult(
    `/api/simulation/exams/${encodeURIComponent(examId)}/remediations`,
    createJsonRequest("POST", { selections }),
  );
}

export function saveFirstSimulationDiary(
  input: { idempotencyKey: string; firstSimulationDiary: string },
): Promise<ApiResult<SimulationDiaryResponse>> {
  return requestApiResult(
    "/api/simulation/first-diary",
    createJsonRequest("POST", input),
  );
}

export function createSimulationStagePlan(
  input: {
    idempotencyKey: string;
    baseRevision?: number | null;
    name: string;
    startDate: string;
    endDate: string;
    goal: string;
    mode: StagePlanDto["mode"];
    status: StagePlanDto["status"];
  },
): Promise<ApiResult<SimulationStagePlanResponse>> {
  return requestApiResult(
    "/api/simulation/stage-plans",
    createJsonRequest("POST", input),
  );
}

export function createSimulationStageAdjustmentDraft(
  input: { idempotencyKey: string; stagePlanId?: string | null },
): Promise<ApiResult<SimulationStageDraftResponse>> {
  return requestApiResult(
    "/api/simulation/stage-adjustment-drafts",
    createJsonRequest("POST", input),
  );
}

export function createAiSimulationStageAdjustmentDraft(
  input: { idempotencyKey: string; stagePlanId?: string | null },
): Promise<ApiResult<SimulationStageDraftResponse>> {
  return requestApiResult(
    "/api/simulation/stage-adjustment-drafts/ai",
    createJsonRequest("POST", input),
  );
}

export function decideSimulationStageAdjustmentDraft(
  draftId: string,
  action: "confirm" | "reject",
  expectedRevision: number,
): Promise<ApiResult<SimulationStageDraftResponse>> {
  return requestApiResult(
    `/api/simulation/stage-adjustment-drafts/${encodeURIComponent(draftId)}/${action}`,
    createJsonRequest("POST", { expectedRevision }),
  );
}
