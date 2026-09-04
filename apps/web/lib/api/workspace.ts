import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type {
  ExamWorkspaceDto,
  SubjectGroupDto,
  WorkspaceSubjectDto,
} from "@/lib/contracts";

export interface WorkspaceMutationResponse {
  workspace?: ExamWorkspaceDto;
  subject?: WorkspaceSubjectDto;
  group?: SubjectGroupDto;
  latest?: ExamWorkspaceDto;
  conflictFields?: string[];
  lifecycle?: {
    pausedReviewScheduleCount?: number;
    resumedReviewScheduleCount?: number;
    remainingPausedReviewScheduleCount?: number;
    ungroupedSubjectCount?: number;
  };
  error?: string;
}

export interface CreateExamWorkspaceInput {
  stableKey: string;
  name: string;
  targetExamDate?: string | null;
  stageSummary?: string | null;
  activate?: boolean;
  subjects?: Array<{
    stableKey: string;
    name: string;
    color: string;
    sortOrder?: number;
    groupStableKey?: "408" | null;
  }>;
  takeoverSubjectIds?: string[];
}

export interface UpdateExamWorkspaceInput {
  expectedRevision: number;
  name?: string;
  targetExamDate?: string | null;
  stageSummary?: string | null;
}

export interface CreateWorkspaceSubjectInput {
  stableKey: string;
  name: string;
  color: string;
  sortOrder?: number;
  groupId?: string | null;
  expectedWorkspaceRevision: number;
}

export interface UpdateWorkspaceSubjectInput {
  expectedWorkspaceRevision: number;
  name?: string;
  color?: string;
  sortOrder?: number;
  groupId?: string | null;
  archived?: boolean;
  move?: "UP" | "DOWN";
}

export interface CreateSubjectGroupInput {
  expectedWorkspaceRevision: number;
  stableKey: string;
  name: string;
  sortOrder?: number;
}

export interface UpdateSubjectGroupInput {
  expectedWorkspaceRevision: number;
  name?: string;
  sortOrder?: number;
  archived?: boolean;
  move?: "UP" | "DOWN";
}

export function createExamWorkspace(
  input: CreateExamWorkspaceInput,
): Promise<ApiResult<WorkspaceMutationResponse>> {
  return requestApiResult("/api/exam-workspaces", createJsonRequest("POST", input));
}

export function updateExamWorkspace(
  workspaceId: string,
  input: UpdateExamWorkspaceInput,
): Promise<ApiResult<WorkspaceMutationResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}`,
    createJsonRequest("PATCH", input),
  );
}

export function activateExamWorkspace(
  workspaceId: string,
  expectedRevision: number,
): Promise<ApiResult<WorkspaceMutationResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/activate`,
    createJsonRequest("POST", { expectedRevision }),
  );
}

export function createWorkspaceSubject(
  workspaceId: string,
  input: CreateWorkspaceSubjectInput,
): Promise<ApiResult<WorkspaceMutationResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/subjects`,
    createJsonRequest("POST", input),
  );
}

export function updateWorkspaceSubject(
  workspaceId: string,
  subjectId: string,
  input: UpdateWorkspaceSubjectInput,
): Promise<ApiResult<WorkspaceMutationResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/subjects/${encodeURIComponent(subjectId)}`,
    createJsonRequest("PATCH", input),
  );
}

export function createSubjectGroup(
  workspaceId: string,
  input: CreateSubjectGroupInput,
): Promise<ApiResult<WorkspaceMutationResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/subject-groups`,
    createJsonRequest("POST", input),
  );
}

export function updateSubjectGroup(
  workspaceId: string,
  groupId: string,
  input: UpdateSubjectGroupInput,
): Promise<ApiResult<WorkspaceMutationResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/subject-groups/${encodeURIComponent(groupId)}`,
    createJsonRequest("PATCH", input),
  );
}
