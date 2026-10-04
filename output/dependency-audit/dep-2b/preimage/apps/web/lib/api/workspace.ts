import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type {
  ExamWorkspaceDto,
  SubjectMergeResultDto,
  SubjectMergeUndoResultDto,
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
  merge?: SubjectMergeResultDto;
  undo?: SubjectMergeUndoResultDto;
  error?: string;
}

export interface ConfirmSubjectMergeInput {
  targetSubjectId: string;
  sourceSubjectIds: string[];
  snapshotHash: string;
  expectedWorkspaceRevision: number;
  idempotencyKey: string;
  confirm: true;
}

export interface UndoSubjectMergeInput {
  expectedWorkspaceRevision: number;
  undoSnapshotHash: string;
  idempotencyKey: string;
  confirm: true;
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
    groupStableKey?: string | null;
  }>;
  groups?: Array<{
    stableKey: string;
    name: string;
    sortOrder?: number;
  }>;
  takeoverSubjectIds?: string[];
}

export interface UpdateExamWorkspaceInput {
  expectedRevision: number;
  name?: string;
  targetExamDate?: string | null;
  stageSummary?: string | null;
  archived?: boolean;
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
  expectedSelectionRevision?: number,
): Promise<ApiResult<WorkspaceMutationResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/activate`,
    createJsonRequest("POST", { expectedRevision, expectedSelectionRevision }),
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

export function confirmSubjectMerge(
  workspaceId: string,
  input: ConfirmSubjectMergeInput,
): Promise<ApiResult<WorkspaceMutationResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/subject-merges`,
    createJsonRequest("POST", input),
  );
}

export function undoSubjectMerge(
  workspaceId: string,
  operationId: string,
  input: UndoSubjectMergeInput,
): Promise<ApiResult<WorkspaceMutationResponse>> {
  return requestApiResult(
    `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/subject-merges/${encodeURIComponent(operationId)}/undo`,
    createJsonRequest("POST", input),
  );
}
