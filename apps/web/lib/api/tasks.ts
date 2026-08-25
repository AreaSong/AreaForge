import { createJsonRequest, requestApiResult, type ApiErrorEnvelope, type ApiResult } from "@/lib/api/client";
import type {
  StudyTaskDto,
  TaskPriorityDto,
  TaskStatusDto,
  TaskUpdateSnapshotDto,
} from "@/lib/contracts";

export interface TaskApiResponse extends ApiErrorEnvelope<StudyTaskDto | TaskUpdateSnapshotDto> {
  task?: StudyTaskDto | TaskUpdateSnapshotDto | { id: string };
}

export interface TaskListResponse {
  tasks?: StudyTaskDto[];
  error?: string;
}

export interface TaskDependencyResponse {
  dependency?: unknown;
  error?: string;
}

export interface CreateTaskInput {
  idempotencyKey: string;
  subjectId: string;
  syllabusNodeId?: string | null;
  relatedSyllabusNodeIds?: string[];
  planMilestoneId?: string | null;
  stagePlanIds?: string[];
  knowledgePointIds?: string[];
  sourceResourceId?: string;
  title: string;
  type?: string;
  priority?: TaskPriorityDto;
  plannedDate?: string;
  estimatedMinutes?: number;
}

export interface CreateTaskOptions {
  headers?: HeadersInit;
}

export interface UpdateTaskInput {
  expectedStatus: TaskStatusDto;
  expectedUpdatedAt: string;
  subjectId?: string;
  syllabusNodeId?: string | null;
  relatedSyllabusNodeIds?: string[];
  planMilestoneId?: string | null;
  stagePlanIds?: string[];
  knowledgePointIds?: string[];
  title?: string;
  type?: string;
  priority?: TaskPriorityDto;
  plannedDate?: string;
  estimatedMinutes?: number;
  reviewText?: string | null;
}

export interface CompleteTaskInput {
  reviewText?: string;
}

export interface DeferTaskInput {
  plannedDate?: string;
  reviewText?: string;
}

export interface RecoverTaskInput {
  plannedDate?: string;
  reviewText?: string;
}

export interface SplitTaskInput {
  title: string;
  plannedDate?: string;
  estimatedMinutes?: number;
  reviewText?: string;
}

export interface ConvertTaskToReviewInput {
  plannedDate?: string;
  estimatedMinutes?: number;
  reviewText?: string;
}

export type TaskDebtReorderCommand =
  | { type: "confirm"; selectedTaskIds: string[] }
  | { type: "reject"; selectedTaskIds: string[] }
  | { type: "apply"; selectedTaskIds: string[] };

export interface TaskDebtReorderResponse {
  decision?: { summary?: string };
  application?: { summary?: string };
  error?: string;
}

export type TaskCommand =
  | { type: "create"; input: CreateTaskInput }
  | { type: "update"; taskId: string; input: UpdateTaskInput }
  | { type: "complete"; taskId: string; input?: CompleteTaskInput }
  | { type: "defer"; taskId: string; input?: DeferTaskInput }
  | { type: "recover"; taskId: string; input?: RecoverTaskInput }
  | { type: "split"; taskId: string; input: SplitTaskInput }
  | { type: "convert-review"; taskId: string; input?: ConvertTaskToReviewInput }
  | { type: "drop"; taskId: string }
  | { type: "debt-reorder"; command: TaskDebtReorderCommand };

export function listTasks(): Promise<ApiResult<TaskListResponse>> {
  return requestApiResult("/api/tasks", { cache: "no-store" });
}

export function createTask(
  input: CreateTaskInput,
  options: CreateTaskOptions = {},
): Promise<ApiResult<TaskApiResponse>> {
  return requestApiResult(
    "/api/tasks",
    createJsonRequest("POST", input, { headers: options.headers }),
  );
}

export function updateTask(
  taskId: string,
  input: UpdateTaskInput,
): Promise<ApiResult<TaskApiResponse>> {
  return requestApiResult(
    `/api/tasks/${encodeURIComponent(taskId)}`,
    createJsonRequest("PATCH", input),
  );
}

export function completeTask(
  taskId: string,
  input?: CompleteTaskInput,
): Promise<ApiResult<TaskApiResponse>> {
  return postTaskCommand(taskId, "complete", input ?? {});
}

export function deferTask(
  taskId: string,
  input?: DeferTaskInput,
): Promise<ApiResult<TaskApiResponse>> {
  return postTaskCommand(taskId, "defer", input ?? {});
}

export function recoverTask(
  taskId: string,
  input?: RecoverTaskInput,
): Promise<ApiResult<TaskApiResponse>> {
  return postTaskCommand(taskId, "recover", input ?? {});
}

export function splitTask(
  taskId: string,
  input: SplitTaskInput,
): Promise<ApiResult<TaskApiResponse>> {
  return postTaskCommand(taskId, "split", input);
}

export function convertTaskToReview(
  taskId: string,
  input?: ConvertTaskToReviewInput,
): Promise<ApiResult<TaskApiResponse>> {
  return postTaskCommand(taskId, "convert-review", input ?? {});
}

export function dropTask(taskId: string): Promise<ApiResult<TaskApiResponse>> {
  return requestApiResult(
    `/api/tasks/${encodeURIComponent(taskId)}/drop`,
    { method: "POST" },
  );
}

export function createTaskDependency(
  taskId: string,
  body: unknown,
): Promise<ApiResult<TaskDependencyResponse>> {
  return requestApiResult(
    `/api/tasks/${encodeURIComponent(taskId)}/dependencies`,
    createJsonRequest("POST", body),
  );
}

export function updateTaskDependency(
  taskId: string,
  dependencyId: string,
  body: unknown,
): Promise<ApiResult<TaskDependencyResponse>> {
  return requestApiResult(
    `/api/tasks/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(dependencyId)}`,
    createJsonRequest("PATCH", body),
  );
}

export function deleteTaskDependency(
  taskId: string,
  dependencyId: string,
  body: unknown,
): Promise<ApiResult<TaskDependencyResponse>> {
  return requestApiResult(
    `/api/tasks/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(dependencyId)}`,
    createJsonRequest("DELETE", body),
  );
}

export function reorderTaskDebt(
  command: TaskDebtReorderCommand,
): Promise<ApiResult<TaskDebtReorderResponse>> {
  return requestApiResult(
    command.type === "apply"
      ? "/api/tasks/debt-reorder/applications"
      : "/api/tasks/debt-reorder/decisions",
    createJsonRequest(
      "POST",
      command.type === "apply"
        ? { selectedTaskIds: command.selectedTaskIds }
        : { action: command.type, selectedTaskIds: command.selectedTaskIds },
    ),
  );
}

export function executeTaskCommand(command: TaskCommand): Promise<ApiResult<TaskApiResponse | TaskDebtReorderResponse>> {
  switch (command.type) {
    case "create":
      return createTask(command.input);
    case "update":
      return updateTask(command.taskId, command.input);
    case "complete":
      return completeTask(command.taskId, command.input);
    case "defer":
      return deferTask(command.taskId, command.input);
    case "recover":
      return recoverTask(command.taskId, command.input);
    case "split":
      return splitTask(command.taskId, command.input);
    case "convert-review":
      return convertTaskToReview(command.taskId, command.input);
    case "drop":
      return dropTask(command.taskId);
    case "debt-reorder":
      return reorderTaskDebt(command.command);
  }
}

function postTaskCommand(
  taskId: string,
  command: "complete" | "defer" | "recover" | "split" | "convert-review",
  input: unknown,
): Promise<ApiResult<TaskApiResponse>> {
  return requestApiResult(
    `/api/tasks/${encodeURIComponent(taskId)}/${command}`,
    createJsonRequest("POST", input),
  );
}
