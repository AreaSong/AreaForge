import {
  previewTaskDebtReorderApplication,
  type TaskDebtReorderAction,
  type TaskDebtReorderApplicationPreview,
  type TaskDebtReorderApplicationPreviewItem,
  type TaskDebtReorderSuggestion,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getNextStudyDayStart, getStudyDayRange } from "./date";
import { refreshCheckInSnapshotsForDates } from "./check-in-service";
import { getTaskDebtReorderSuggestion } from "./service";
import { createTaskDebtEvent } from "./task-debt-event-service";
import type { TaskDebtReorderDto, TaskDebtReorderSuggestionDto } from "./types";

type TaskDebtReorderClient = PrismaClient | Prisma.TransactionClient;
type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type DbTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const maxSelectedTaskDebtReorderItems = 5;
const reorderBoundary = "only_selected_task_debt_reorder_items";

export type TaskDebtReorderDecisionAction = "confirm" | "reject";

export interface DecideTaskDebtReorderInput {
  action: TaskDebtReorderDecisionAction;
  selectedTaskIds: string[];
}

export interface ApplyTaskDebtReorderInput {
  selectedTaskIds: string[];
}

export interface TaskDebtReorderSkippedItem {
  taskId: string;
  reason: string;
  detail: string;
}

export interface TaskDebtReorderDecisionResult {
  action: TaskDebtReorderDecisionAction;
  recorded: Array<{
    taskId: string;
    action: TaskDebtReorderAction;
    taskTitle: string;
  }>;
  skipped: TaskDebtReorderSkippedItem[];
  summary: string;
  canAutoApply: false;
  requiresUserConfirmation: true;
}

export interface TaskDebtReorderApplicationResult {
  applied: Array<{
    taskId: string;
    action: TaskDebtReorderAction;
    mutation: string;
    relatedTaskId: string | null;
  }>;
  skipped: TaskDebtReorderSkippedItem[];
  preview: TaskDebtReorderApplicationPreview;
  stoppedOnFirstFailure: boolean;
  summary: string;
  canAutoApply: false;
  requiresUserConfirmation: true;
}

interface ReorderTaskRecord {
  id: string;
  subjectId: string;
  syllabusNodeId: string | null;
  parentTaskId: string | null;
  title: string;
  type: string;
  status: DbTaskStatus;
  priority: DbTaskPriority;
  debtStatus: string;
  plannedDate: Date;
  estimatedMinutes: number;
  actualMinutes: number;
  reviewText: string | null;
  completedAt: Date | null;
}

interface AppliedReorderItem {
  taskId: string;
  action: TaskDebtReorderAction;
  mutation: string;
  relatedTaskId: string | null;
  changedDates: Date[];
}

export async function decideTaskDebtReorder(
  input: DecideTaskDebtReorderInput,
  actorId: string,
  now = new Date(),
): Promise<TaskDebtReorderDecisionResult> {
  const selectedTaskIds = normalizeSelectedTaskIds(input.selectedTaskIds);
  const debtReorder = await getTaskDebtReorderSuggestion(now);
  const selectedSuggestions = selectCurrentSuggestions(debtReorder, selectedTaskIds);
  const tasksById = await getReorderTasksById(selectedSuggestions.map((suggestion) => suggestion.taskId));
  const skipped = [
    ...createMissingSuggestionSkippedItems(selectedTaskIds, selectedSuggestions),
    ...createMissingTaskSkippedItems(selectedSuggestions, tasksById),
  ];
  const recordedSuggestions = selectedSuggestions.filter((suggestion) => tasksById.has(suggestion.taskId));

  if (recordedSuggestions.length === 0) {
    throw new ApiError("TASK_DEBT_REORDER_SELECTION_STALE", 409);
  }

  await prisma.$transaction(async (tx) => {
    for (const suggestion of recordedSuggestions) {
      const task = tasksById.get(suggestion.taskId);
      if (!task) continue;
      await createTaskDebtEvent({
        taskId: task.id,
        actorId,
        action: "reorder_suggested",
        from: toTaskDebtEventState(task),
        to: toTaskDebtEventState(task),
        reason: createDecisionReason(input.action, suggestion),
        metadata: {
          source: "task_debt_reorder_decision_api",
          decision: input.action === "confirm" ? "confirmed" : "rejected",
          suggestionAction: suggestion.action,
          suggestionRank: suggestion.rank,
          estimatedMinutes: suggestion.estimatedMinutes,
          pressure: debtReorder.pressure,
          availableMinutes: debtReorder.availableMinutes,
          canAutoApply: false,
          requiresUserConfirmation: true,
          boundary: reorderBoundary,
        },
      }, tx);
    }

    await audit(tx, actorId, input.action === "confirm" ? "TASK_DEBT_REORDER_CONFIRMED" : "TASK_DEBT_REORDER_REJECTED", {
      selectedCount: selectedTaskIds.length,
      recordedCount: recordedSuggestions.length,
      skippedCount: skipped.length,
      pressure: debtReorder.pressure,
      canAutoApply: false,
      requiresUserConfirmation: true,
      boundary: reorderBoundary,
    });
  });

  return {
    action: input.action,
    recorded: recordedSuggestions.map((suggestion) => ({
      taskId: suggestion.taskId,
      action: suggestion.action,
      taskTitle: suggestion.taskTitle,
    })),
    skipped,
    summary: createDecisionSummary(input.action, recordedSuggestions.length, skipped.length),
    canAutoApply: false,
    requiresUserConfirmation: true,
  };
}

export async function applyTaskDebtReorder(
  input: ApplyTaskDebtReorderInput,
  actorId: string,
  now = new Date(),
): Promise<TaskDebtReorderApplicationResult> {
  const selectedTaskIds = normalizeSelectedTaskIds(input.selectedTaskIds);
  const debtReorder = await getTaskDebtReorderSuggestion(now);
  const currentTasks = await getReorderTasksById(selectedTaskIds);
  const preview = previewTaskDebtReorderApplication({
    suggestions: toCoreSuggestions(debtReorder.suggestions),
    selectedTaskIds,
    currentTasks: selectedTaskIds.flatMap((taskId) => {
      const task = currentTasks.get(taskId);
      return task ? [{ id: task.id, status: task.status, debtStatus: task.debtStatus }] : [];
    }),
    maxApplyCount: maxSelectedTaskDebtReorderItems,
  });
  const shouldStopOnFirstFailure = preview.shouldStopOnFirstFailure;

  if (preview.skipped.length > 0 && shouldStopOnFirstFailure) {
    await audit(prisma, actorId, "TASK_DEBT_REORDER_APPLICATION_BLOCKED", {
      selectedCount: selectedTaskIds.length,
      skippedCount: preview.skipped.length,
      shouldStopOnFirstFailure,
      pressure: debtReorder.pressure,
      canAutoApply: false,
      requiresUserConfirmation: true,
      boundary: reorderBoundary,
    });

    return {
      applied: [],
      skipped: preview.skipped,
      preview,
      stoppedOnFirstFailure: true,
      summary: `${preview.summary} 已按 shouldStopOnFirstFailure 停止写入，请只选择仍有效的建议后重试。`,
      canAutoApply: false,
      requiresUserConfirmation: true,
    };
  }

  if (preview.items.length === 0) {
    throw new ApiError("TASK_DEBT_REORDER_SELECTION_STALE", 409);
  }

  const applied = await prisma.$transaction(async (tx) => {
    const txTasks = await getReorderTasksById(preview.items.map((item) => item.taskId), tx);
    assertPreviewStillCurrent(preview.items, txTasks);
    const appliedItems: AppliedReorderItem[] = [];

    for (const item of preview.items) {
      const task = txTasks.get(item.taskId);
      if (!task) {
        if (shouldStopOnFirstFailure) throw new ApiError("TASK_DEBT_REORDER_SELECTION_STALE", 409);
        continue;
      }
      appliedItems.push(await applySelectedDebtReorderItem(tx, item, task, actorId, now));
    }

    await audit(tx, actorId, "TASK_DEBT_REORDER_APPLIED", {
      selectedCount: selectedTaskIds.length,
      appliedCount: appliedItems.length,
      skippedCount: preview.skipped.length,
      shouldStopOnFirstFailure,
      pressure: debtReorder.pressure,
      canAutoApply: false,
      requiresUserConfirmation: true,
      boundary: reorderBoundary,
    });
    await refreshCheckInSnapshotsForDates(uniqueDates(appliedItems.flatMap((item) => item.changedDates)), tx);

    return appliedItems;
  });

  return {
    applied: applied.map((item) => ({
      taskId: item.taskId,
      action: item.action,
      mutation: item.mutation,
      relatedTaskId: item.relatedTaskId,
    })),
    skipped: [],
    preview,
    stoppedOnFirstFailure: false,
    summary: `已应用 ${applied.length} 个用户所选债务重排建议；没有自动处理未选择项。`,
    canAutoApply: false,
    requiresUserConfirmation: true,
  };
}

function normalizeSelectedTaskIds(taskIds: string[]): string[] {
  const normalized = Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)));
  if (normalized.length === 0) {
    throw new ApiError("TASK_DEBT_REORDER_SELECTION_REQUIRED", 400);
  }
  if (normalized.length > maxSelectedTaskDebtReorderItems) {
    throw new ApiError("TASK_DEBT_REORDER_SELECTION_TOO_LARGE", 400);
  }
  return normalized;
}

function selectCurrentSuggestions(
  debtReorder: TaskDebtReorderDto,
  selectedTaskIds: string[],
): TaskDebtReorderSuggestionDto[] {
  const suggestionsByTaskId = new Map(debtReorder.suggestions.map((suggestion) => [suggestion.taskId, suggestion]));
  return selectedTaskIds.flatMap((taskId) => {
    const suggestion = suggestionsByTaskId.get(taskId);
    return suggestion ? [suggestion] : [];
  });
}

function createMissingSuggestionSkippedItems(
  selectedTaskIds: string[],
  suggestions: TaskDebtReorderSuggestionDto[],
): TaskDebtReorderSkippedItem[] {
  const suggestionTaskIds = new Set(suggestions.map((suggestion) => suggestion.taskId));
  return selectedTaskIds
    .filter((taskId) => !suggestionTaskIds.has(taskId))
    .map((taskId) => ({
      taskId,
      reason: "missing_suggestion",
      detail: "所选任务已不在当前债务重排建议中，请刷新后重新选择。",
    }));
}

function createMissingTaskSkippedItems(
  suggestions: TaskDebtReorderSuggestionDto[],
  tasksById: Map<string, ReorderTaskRecord>,
): TaskDebtReorderSkippedItem[] {
  return suggestions
    .filter((suggestion) => !tasksById.has(suggestion.taskId))
    .map((suggestion) => ({
      taskId: suggestion.taskId,
      reason: "missing_task",
      detail: "所选任务已不存在或当前用户不可见，请刷新后重新选择。",
    }));
}

async function getReorderTasksById(
  taskIds: string[],
  client: TaskDebtReorderClient = prisma,
): Promise<Map<string, ReorderTaskRecord>> {
  if (taskIds.length === 0) return new Map();
  const tasks = await client.studyTask.findMany({
    where: {
      id: {
        in: taskIds,
      },
    },
    select: {
      id: true,
      subjectId: true,
      syllabusNodeId: true,
      parentTaskId: true,
      title: true,
      type: true,
      status: true,
      priority: true,
      debtStatus: true,
      plannedDate: true,
      estimatedMinutes: true,
      actualMinutes: true,
      reviewText: true,
      completedAt: true,
    },
  });
  return new Map(tasks.map((task) => [task.id, task]));
}

function toCoreSuggestions(suggestions: TaskDebtReorderSuggestionDto[]): TaskDebtReorderSuggestion[] {
  return suggestions.map((suggestion) => ({
    taskId: suggestion.taskId,
    action: suggestion.action,
    reason: suggestion.reason,
    estimatedMinutes: suggestion.estimatedMinutes,
    rank: suggestion.rank,
  }));
}

function assertPreviewStillCurrent(
  items: TaskDebtReorderApplicationPreviewItem[],
  tasksById: Map<string, ReorderTaskRecord>,
): void {
  for (const item of items) {
    const task = tasksById.get(item.taskId);
    if (!task || task.status === "DONE" || task.status === "SKIPPED" || task.debtStatus === "NONE") {
      throw new ApiError("TASK_DEBT_REORDER_SELECTION_STALE", 409);
    }
  }
}

async function applySelectedDebtReorderItem(
  tx: Prisma.TransactionClient,
  item: TaskDebtReorderApplicationPreviewItem,
  task: ReorderTaskRecord,
  actorId: string,
  now: Date,
): Promise<AppliedReorderItem> {
  const dayStart = getStudyDayRange(now).start;
  const nextDayStart = getNextStudyDayStart(now);
  const result = await mutateTaskForDebtReorderItem(tx, item, task, dayStart, nextDayStart);
  const updatedTask = result.task ?? task;

  await createTaskDebtEvent({
    taskId: task.id,
    actorId,
    action: "reorder_applied",
    from: toTaskDebtEventState(task),
    to: toTaskDebtEventState(updatedTask),
    relatedTaskId: result.relatedTaskId,
    reason: item.reason,
    metadata: {
      source: "task_debt_reorder_application_api",
      suggestionAction: item.action,
      mutation: item.mutation,
      suggestionRank: item.rank,
      estimatedMinutes: item.estimatedMinutes,
      fromPlannedDate: task.plannedDate.toISOString(),
      toPlannedDate: updatedTask.plannedDate.toISOString(),
      relatedTaskId: result.relatedTaskId,
      canAutoApply: false,
      requiresUserConfirmation: true,
      boundary: reorderBoundary,
    },
  }, tx);

  return {
    taskId: task.id,
    action: item.action,
    mutation: item.mutation,
    relatedTaskId: result.relatedTaskId,
    changedDates: uniqueDates([task.plannedDate, updatedTask.plannedDate, result.childPlannedDate ?? null]),
  };
}

async function mutateTaskForDebtReorderItem(
  tx: Prisma.TransactionClient,
  item: TaskDebtReorderApplicationPreviewItem,
  task: ReorderTaskRecord,
  dayStart: Date,
  nextDayStart: Date,
): Promise<{ task: ReorderTaskRecord | null; relatedTaskId: string | null; childPlannedDate: Date | null }> {
  switch (item.mutation) {
    case "none":
      return { task: null, relatedTaskId: null, childPlannedDate: null };
    case "recover":
      return {
        task: await updateReorderTask(tx, task.id, {
          status: "TODO",
          debtStatus: "ACCEPTABLE",
          plannedDate: dayStart,
          completedAt: null,
          reviewText: mergeTaskReviewText(task.reviewText, `债务重排：${item.reason}`),
        }),
        relatedTaskId: null,
        childPlannedDate: null,
      };
    case "defer":
      return {
        task: await updateReorderTask(tx, task.id, {
          status: "DEFERRED",
          debtStatus: "ACCEPTABLE",
          plannedDate: nextDayStart,
          reviewText: mergeTaskReviewText(task.reviewText, `债务重排延期：${item.reason}`),
        }),
        relatedTaskId: null,
        childPlannedDate: null,
      };
    case "drop":
      return {
        task: await updateReorderTask(tx, task.id, {
          status: "SKIPPED",
          debtStatus: "NONE",
          reviewText: mergeTaskReviewText(task.reviewText, `债务重排放弃：${item.reason}`),
        }),
        relatedTaskId: null,
        childPlannedDate: null,
      };
    case "split": {
      const child = await tx.studyTask.create({
        data: {
          subjectId: task.subjectId,
          syllabusNodeId: task.syllabusNodeId,
          parentTaskId: task.id,
          title: `${task.title} / 最小推进`,
          type: task.type === "simulation_exam" ? "review" : task.type,
          status: "TODO",
          priority: task.priority,
          debtStatus: "ACCEPTABLE",
          plannedDate: dayStart,
          estimatedMinutes: item.estimatedMinutes,
          reviewText: `债务重排拆小：由「${task.title}」生成。${item.reason}`,
        },
        select: {
          id: true,
          plannedDate: true,
        },
      });
      return {
        task: await updateReorderTask(tx, task.id, {
          status: "DEFERRED",
          debtStatus: "ACCEPTABLE",
          plannedDate: nextDayStart,
          reviewText: mergeTaskReviewText(task.reviewText, `债务重排拆小：生成「${child.id}」作为最小推进任务`),
        }),
        relatedTaskId: child.id,
        childPlannedDate: child.plannedDate,
      };
    }
    case "convert_review":
      return {
        task: await updateReorderTask(tx, task.id, {
          type: "review",
          status: "TODO",
          debtStatus: "ACCEPTABLE",
          plannedDate: dayStart,
          estimatedMinutes: item.estimatedMinutes,
          completedAt: null,
          reviewText: mergeTaskReviewText(task.reviewText, `债务重排改复习：${item.reason}`),
        }),
        relatedTaskId: null,
        childPlannedDate: null,
      };
  }
}

async function updateReorderTask(
  tx: Prisma.TransactionClient,
  taskId: string,
  data: Prisma.StudyTaskUpdateInput,
): Promise<ReorderTaskRecord> {
  return tx.studyTask.update({
    where: { id: taskId },
    data,
    select: {
      id: true,
      subjectId: true,
      syllabusNodeId: true,
      parentTaskId: true,
      title: true,
      type: true,
      status: true,
      priority: true,
      debtStatus: true,
      plannedDate: true,
      estimatedMinutes: true,
      actualMinutes: true,
      reviewText: true,
      completedAt: true,
    },
  });
}

function createDecisionReason(
  action: TaskDebtReorderDecisionAction,
  suggestion: TaskDebtReorderSuggestionDto,
): string {
  return action === "confirm"
    ? `确认债务重排建议：${labelDebtAction(suggestion.action)}「${suggestion.taskTitle}」。`
    : `驳回债务重排建议：${labelDebtAction(suggestion.action)}「${suggestion.taskTitle}」。`;
}

function createDecisionSummary(
  action: TaskDebtReorderDecisionAction,
  recordedCount: number,
  skippedCount: number,
): string {
  const verb = action === "confirm" ? "确认" : "驳回";
  return `已${verb} ${recordedCount} 个用户所选债务重排建议；${skippedCount} 个所选项已跳过。`;
}

function mergeTaskReviewText(existing: string | null, addition: string): string {
  const merged = existing?.trim() ? `${existing.trim()}\n${addition}` : addition;
  return merged.slice(0, 2000);
}

function labelDebtAction(action: TaskDebtReorderAction): string {
  switch (action) {
    case "keep":
      return "保留";
    case "recover":
      return "补做";
    case "defer":
      return "延期";
    case "split":
      return "拆小";
    case "drop":
      return "放弃";
    case "convert_review":
      return "改复习";
  }
}

function toTaskDebtEventState(task: {
  status: DbTaskStatus;
  debtStatus: string;
}) {
  return {
    status: task.status,
    debtStatus: task.debtStatus,
  };
}

function uniqueDates(dates: Array<Date | null>): Date[] {
  const byTime = new Map<number, Date>();
  for (const date of dates) {
    if (date) byTime.set(date.getTime(), date);
  }
  return Array.from(byTime.values());
}

async function audit(
  client: TaskDebtReorderClient,
  actorId: string,
  action: string,
  metadata: Prisma.InputJsonObject,
): Promise<void> {
  await client.auditEvent.create({
    data: {
      actorId,
      action,
      entityType: "TaskDebtReorder",
      entityId: null,
      metadata,
    },
  });
}
