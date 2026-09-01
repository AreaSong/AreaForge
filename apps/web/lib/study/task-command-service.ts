import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getNextStudyDayStart, getStudyDayRange } from "./date";
import { applyTaskCas } from "./concurrency";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
} from "./persistent-idempotency";
import { createTaskDebtEvent } from "./task-debt-event-service";
import { refreshWorkspaceCheckInsForDates } from "./task-command-support";
import {
  assertActiveTaskKnowledgePoints,
  assertActiveTaskRelations,
  assertSubjectExists,
  assertTaskSourceStatus,
  assertTaskSyllabusRelationsDistinct,
  assertTaskUpdateExpectation,
  getTaskCommandPreimage,
  getUpdatedTaskForResponse,
  mergeTaskReviewText,
  nextTaskUpdatedAt,
  normalizeTaskDebtReason,
  normalizeTaskKnowledgePointIds,
  normalizeTaskRelatedNodeIds,
  normalizeTaskStageIds,
  parseStudyTaskSnapshot,
  sameStringSet,
  taskUpdateConflict,
  toTaskDebtEventState,
} from "./task-command-support";
import { serializeTask, toDbPriority } from "./task-serializer";
import { audit } from "./study-audit";
import type {
  ConvertTaskToReviewInput,
  CreateTaskInput,
  RecoverTaskInput,
  SplitTaskInput,
  UpdateTaskInput,
} from "./study-service-contracts";
import type { StudyTaskDto } from "@/lib/contracts";

export async function createStudyTask(input: CreateTaskInput, actorId: string): Promise<StudyTaskDto> {
  const day = input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start;
  const relatedSyllabusNodeIds = normalizeTaskRelatedNodeIds(input.relatedSyllabusNodeIds ?? []);
  const stagePlanIds = normalizeTaskStageIds(input.stagePlanIds ?? []);
  const knowledgePointIds = normalizeTaskKnowledgePointIds(input.knowledgePointIds ?? []);
  assertTaskSyllabusRelationsDistinct(input.syllabusNodeId ?? null, relatedSyllabusNodeIds);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("study-task-create-v1", {
    subjectId: input.subjectId,
    syllabusNodeId: input.syllabusNodeId ?? null,
    relatedSyllabusNodeIds,
    planMilestoneId: input.planMilestoneId ?? null,
    stagePlanIds,
    knowledgePointIds,
    sourceResourceId: input.sourceResourceId ?? null,
    title: input.title,
    type: input.type,
    priority: input.priority,
    plannedDate: day.toISOString(),
    estimatedMinutes: input.estimatedMinutes,
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = {
      actorId,
      workspaceId: workspace.id,
      action: "STUDY_TASK_CREATED",
      entityType: "StudyTask",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "STUDY_TASK_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parseStudyTaskSnapshot(replay.resultSnapshot);
      if (snapshot) return snapshot;
      const storedTask = await tx.studyTask.findFirst({
        where: { id: replay.resultId, subject: { workspaceId: workspace.id } },
        include: {
          subject: true,
          syllabusNode: true,
          stageLinks: { include: { stagePlan: { select: { name: true } } } },
          knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
        },
      });
      if (!storedTask) throw new ApiError("STUDY_TASK_IDEMPOTENCY_RESULT_NOT_FOUND", 409);
      return serializeTask(storedTask);
    }
    await assertSubjectExists(input.subjectId, workspace.id, tx);
    const sourceResource = input.sourceResourceId ? await tx.studyResource.findFirst({
      where: { id: input.sourceResourceId, workspaceId: workspace.id },
      select: { id: true, subjectId: true, archivedAt: true, revision: true },
    }) : null;
    if (input.sourceResourceId && !sourceResource) throw new ApiError("STUDY_RESOURCE_NOT_FOUND", 404);
    if (sourceResource?.archivedAt) {
      throw new ApiError("STUDY_RESOURCE_ARCHIVED", 409, {
        latest: sourceResource,
        conflictFields: ["archivedAt"],
        workbench: "/knowledge/resources",
      });
    }
    if (sourceResource?.subjectId && sourceResource.subjectId !== input.subjectId) {
      throw new ApiError("STUDY_RESOURCE_SUBJECT_MISMATCH", 409, {
        latest: sourceResource,
        conflictFields: ["subjectId"],
        workbench: "/knowledge/resources",
      });
    }
    await assertActiveTaskRelations(tx, workspace.id, input.subjectId, {
      syllabusNodeIds: [input.syllabusNodeId, ...relatedSyllabusNodeIds].filter((id): id is string => Boolean(id)),
      planMilestoneId: input.planMilestoneId ?? null,
      stagePlanIds,
    });
    await assertActiveTaskKnowledgePoints(tx, workspace.id, input.subjectId, knowledgePointIds);
    const createdTask = await tx.studyTask.create({
      data: {
        subjectId: input.subjectId,
        syllabusNodeId: input.syllabusNodeId ?? null,
        planMilestoneId: input.planMilestoneId ?? null,
        title: input.title,
        type: input.type,
        priority: toDbPriority(input.priority),
        plannedDate: day,
        estimatedMinutes: input.estimatedMinutes,
      },
      include: {
        subject: true,
        syllabusNode: true,
        knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
      },
    });
    if (relatedSyllabusNodeIds.length > 0) {
      await tx.studyTaskRelatedSyllabusNode.createMany({
        data: relatedSyllabusNodeIds.map((syllabusNodeId) => ({ taskId: createdTask.id, syllabusNodeId })),
      });
    }
    if (stagePlanIds.length > 0) {
      await tx.studyTaskStageLink.createMany({
        data: stagePlanIds.map((stagePlanId) => ({ taskId: createdTask.id, stagePlanId })),
      });
    }
    if (knowledgePointIds.length > 0) {
      await tx.studyTaskKnowledgePoint.createMany({
        data: knowledgePointIds.map((knowledgePointId) => ({ taskId: createdTask.id, knowledgePointId })),
      });
    }
    if (sourceResource) {
      await tx.studyResourceTaskLink.create({
        data: { resourceId: sourceResource.id, taskId: createdTask.id },
      });
      const updatedResource = await tx.studyResource.updateMany({
        where: {
          id: sourceResource.id,
          workspaceId: workspace.id,
          archivedAt: null,
          revision: sourceResource.revision,
        },
        data: { revision: { increment: 1 }, actorId },
      });
      if (updatedResource.count !== 1) {
        throw new ApiError("STUDY_RESOURCE_REVISION_CONFLICT", 409, {
          conflictFields: ["revision", "archivedAt"],
          workbench: "/knowledge/resources",
        });
      }
    }

    const result = serializeTask(await getUpdatedTaskForResponse(tx, createdTask.id));
    await recordPersistentCreateResult(tx, command, createdTask.id, {
      resultSnapshot: result as unknown as Prisma.InputJsonObject,
    });
    if (sourceResource) {
      await tx.auditEvent.create({
        data: {
          actorId,
          action: "STUDY_RESOURCE_TASK_LINKED",
          entityType: "StudyResource",
          entityId: sourceResource.id,
          metadata: { taskId: createdTask.id },
        },
      });
    }
    await refreshWorkspaceCheckInsForDates(actorId, [createdTask.plannedDate], tx);

    return result;
  });
}

export async function updateStudyTask(id: string, input: UpdateTaskInput, actorId: string): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    const workspace = await resolveActiveWorkspace(actorId, tx);
    await assertTaskUpdateExpectation(tx, workspace.id, existing, input);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"]);

    const resolvedSubjectId = input.subjectId ?? existing.subjectId;
    const resolvedSyllabusNodeId = input.syllabusNodeId === undefined ? existing.syllabusNodeId : input.syllabusNodeId;
    const resolvedRelatedNodeIds = input.relatedSyllabusNodeIds === undefined
      ? existing.relatedSyllabusNodeIds
      : normalizeTaskRelatedNodeIds(input.relatedSyllabusNodeIds);
    const resolvedPlanMilestoneId = input.planMilestoneId === undefined
      ? existing.planMilestoneId
      : input.planMilestoneId;
    const resolvedStagePlanIds = input.stagePlanIds === undefined
      ? existing.stagePlanIds
      : normalizeTaskStageIds(input.stagePlanIds);
    const resolvedKnowledgePointIds = input.knowledgePointIds === undefined
      ? existing.knowledgePointIds
      : normalizeTaskKnowledgePointIds(input.knowledgePointIds);
    const subjectChanged = resolvedSubjectId !== existing.subjectId;
    const relatedNodesChanged = !sameStringSet(resolvedRelatedNodeIds, existing.relatedSyllabusNodeIds);
    const primaryNodeChanged = resolvedSyllabusNodeId !== existing.syllabusNodeId;
    const milestoneChanged = resolvedPlanMilestoneId !== existing.planMilestoneId;
    const stagePlansChanged = !sameStringSet(resolvedStagePlanIds, existing.stagePlanIds);
    const knowledgePointsChanged = !sameStringSet(resolvedKnowledgePointIds, existing.knowledgePointIds);

    assertTaskSyllabusRelationsDistinct(resolvedSyllabusNodeId, resolvedRelatedNodeIds);
    if (existing.reviewScheduleId && subjectChanged) {
      throw await taskUpdateConflict(tx, workspace.id, id, ["subjectId", "reviewScheduleId"]);
    }
    await assertSubjectExists(resolvedSubjectId, workspace.id, tx);
    try {
      await assertActiveTaskRelations(tx, workspace.id, resolvedSubjectId, {
        syllabusNodeIds: [
          ...(subjectChanged || primaryNodeChanged ? [resolvedSyllabusNodeId] : []),
          ...(subjectChanged || relatedNodesChanged ? resolvedRelatedNodeIds : []),
        ].filter((nodeId): nodeId is string => Boolean(nodeId)),
        planMilestoneId: subjectChanged || milestoneChanged ? resolvedPlanMilestoneId : null,
        stagePlanIds: subjectChanged || stagePlansChanged ? resolvedStagePlanIds : [],
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw await taskUpdateConflict(tx, workspace.id, id, error.details?.conflictFields ?? ["relations"]);
      }
      throw error;
    }
    try {
      await assertActiveTaskKnowledgePoints(tx, workspace.id, resolvedSubjectId, resolvedKnowledgePointIds);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw await taskUpdateConflict(tx, workspace.id, id, error.details?.conflictFields ?? ["knowledgePointIds"]);
      }
      throw error;
    }

    try {
      await applyTaskCas(tx, existing, {
        subjectId: input.subjectId,
        syllabusNodeId: input.syllabusNodeId,
        planMilestoneId: input.planMilestoneId,
        title: input.title,
        type: input.type,
        priority: input.priority ? toDbPriority(input.priority) : undefined,
        plannedDate: input.plannedDate ? new Date(input.plannedDate) : undefined,
        estimatedMinutes: input.estimatedMinutes,
        reviewText: input.reviewText,
        updatedAt: nextTaskUpdatedAt(existing.updatedAt),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw await taskUpdateConflict(tx, workspace.id, id, ["status", "updatedAt"]);
      }
      throw error;
    }
    if (relatedNodesChanged) {
      await tx.studyTaskRelatedSyllabusNode.deleteMany({ where: { taskId: id } });
      if (resolvedRelatedNodeIds.length > 0) {
        await tx.studyTaskRelatedSyllabusNode.createMany({
          data: resolvedRelatedNodeIds.map((syllabusNodeId) => ({ taskId: id, syllabusNodeId })),
        });
      }
    }
    if (stagePlansChanged) {
      await tx.studyTaskStageLink.deleteMany({ where: { taskId: id } });
      if (resolvedStagePlanIds.length > 0) {
        await tx.studyTaskStageLink.createMany({
          data: resolvedStagePlanIds.map((stagePlanId) => ({ taskId: id, stagePlanId })),
        });
      }
    }
    if (knowledgePointsChanged) {
      await tx.studyTaskKnowledgePoint.deleteMany({ where: { taskId: id } });
      if (resolvedKnowledgePointIds.length > 0) {
        await tx.studyTaskKnowledgePoint.createMany({
          data: resolvedKnowledgePointIds.map((knowledgePointId) => ({ taskId: id, knowledgePointId })),
        });
      }
    }
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_UPDATED", "StudyTask", updatedTask.id, tx);
    if (input.plannedDate) {
      await refreshWorkspaceCheckInsForDates(actorId, [existing.plannedDate, updatedTask.plannedDate], tx);
    }

    return updatedTask;
  });

  return serializeTask(task);
}

export async function completeStudyTask(id: string, reviewText: string | undefined, actorId: string): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"]);
    if (existing.reviewScheduleId) {
      throw new ApiError("REVIEW_BRIDGE_COMPLETE_REQUIRES_RESULT", 409, {
        conflictFields: ["reviewScheduleId", "result"],
      });
    }

    const completedAt = new Date();
    await applyTaskCas(tx, existing, {
      status: "DONE",
      debtStatus: "NONE",
      reviewText,
      completedAt,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_COMPLETED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "complete",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: normalizeTaskDebtReason(reviewText, "手动完成任务"),
      metadata: {
        source: "task_complete_api",
        plannedDate: existing.plannedDate.toISOString(),
        completedAt: completedAt.toISOString(),
        reviewTextProvided: Boolean(reviewText?.trim()),
        taskType: existing.type,
        actualMinutes: updatedTask.actualMinutes,
      },
    }, tx);
    await refreshWorkspaceCheckInsForDates(actorId, [updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function deferStudyTask(id: string, plannedDate: string | undefined, reviewText: string | undefined, actorId: string): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"], true);

    const targetPlannedDate = plannedDate ? new Date(plannedDate) : getNextStudyDayStart();
    await applyTaskCas(tx, existing, {
      status: "DEFERRED",
      debtStatus: "ACCEPTABLE",
      plannedDate: targetPlannedDate,
      reviewText,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_DEFERRED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "defer",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: normalizeTaskDebtReason(reviewText, "延期到下一学习日"),
      metadata: {
        source: "task_defer_api",
        fromPlannedDate: existing.plannedDate.toISOString(),
        toPlannedDate: targetPlannedDate.toISOString(),
        requestedPlannedDate: plannedDate ?? null,
        defaultedToNextStudyDay: plannedDate === undefined,
        taskType: existing.type,
      },
    }, tx);
    await refreshWorkspaceCheckInsForDates(actorId, [existing.plannedDate, updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function dropStudyTask(id: string, actorId: string): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"], true);

    await applyTaskCas(tx, existing, {
      status: "SKIPPED",
      debtStatus: "NONE",
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_DROPPED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "drop",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: "放弃当前任务",
      metadata: {
        source: "task_drop_api",
        plannedDate: existing.plannedDate.toISOString(),
        taskType: existing.type,
        previousCompletedAt: existing.completedAt?.toISOString() ?? null,
      },
    }, tx);
    await refreshWorkspaceCheckInsForDates(actorId, [updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function recoverStudyTask(id: string, input: RecoverTaskInput, actorId: string): Promise<StudyTaskDto> {
  const targetPlannedDate = input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start;
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED", "SKIPPED"]);
    await applyTaskCas(tx, existing, {
      status: "TODO",
      debtStatus: "ACCEPTABLE",
      plannedDate: targetPlannedDate,
      reviewText: mergeTaskReviewText(existing.reviewText, input.reviewText, "补做：拉回今天作为恢复任务"),
      completedAt: null,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_RECOVERED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "recover",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: normalizeTaskDebtReason(input.reviewText, "补做：拉回今天作为恢复任务"),
      metadata: {
        source: "task_recover_api",
        fromPlannedDate: existing.plannedDate.toISOString(),
        toPlannedDate: targetPlannedDate.toISOString(),
        requestedPlannedDate: input.plannedDate ?? null,
        previousCompletedAt: existing.completedAt?.toISOString() ?? null,
        taskType: existing.type,
      },
    }, tx);
    await refreshWorkspaceCheckInsForDates(actorId, [existing.plannedDate, updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function splitStudyTask(id: string, input: SplitTaskInput, actorId: string): Promise<{
  originalTask: StudyTaskDto;
  task: StudyTaskDto;
}> {
  const plannedDate = input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start;

  const [originalTask, task] = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"]);
    const createdTask = await tx.studyTask.create({
      data: {
        subjectId: existing.subjectId,
        syllabusNodeId: existing.syllabusNodeId,
        planMilestoneId: existing.planMilestoneId,
        parentTaskId: existing.id,
        title: input.title,
        type: existing.type === "simulation_exam" ? "review" : existing.type,
        status: "TODO",
        priority: existing.priority,
        debtStatus: "ACCEPTABLE",
        plannedDate,
        estimatedMinutes: input.estimatedMinutes,
        reviewText: mergeTaskReviewText(null, input.reviewText, `由任务「${existing.title}」拆小而来`),
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    if (existing.stagePlanIds.length > 0) {
      await tx.studyTaskStageLink.createMany({
        data: existing.stagePlanIds.map((stagePlanId) => ({ taskId: createdTask.id, stagePlanId })),
      });
    }
    if (existing.relatedSyllabusNodeIds.length > 0) {
      await tx.studyTaskRelatedSyllabusNode.createMany({
        data: existing.relatedSyllabusNodeIds.map((syllabusNodeId) => ({ taskId: createdTask.id, syllabusNodeId })),
      });
    }
    if (existing.knowledgePointIds.length > 0) {
      await tx.studyTaskKnowledgePoint.createMany({
        data: existing.knowledgePointIds.map((knowledgePointId) => ({ taskId: createdTask.id, knowledgePointId })),
      });
    }

    await applyTaskCas(tx, existing, {
      status: "DEFERRED",
      debtStatus: "ACCEPTABLE",
      reviewText: mergeTaskReviewText(existing.reviewText, input.reviewText, `拆小：生成「${input.title}」作为最小推进任务`),
    });
    const updatedOriginal = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_SPLIT_LIGHTWEIGHT", "StudyTask", createdTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedOriginal.id,
      actorId,
      action: "split",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedOriginal),
      relatedTaskId: createdTask.id,
      reason: normalizeTaskDebtReason(input.reviewText, `拆小：生成「${input.title}」作为最小推进任务`),
      metadata: {
        source: "task_split_api",
        childTaskId: createdTask.id,
        childTitle: createdTask.title,
        childPlannedDate: createdTask.plannedDate.toISOString(),
        childEstimatedMinutes: createdTask.estimatedMinutes,
        childType: createdTask.type,
        parentTaskId: existing.id,
        originalEstimatedMinutes: existing.estimatedMinutes,
        originalStatusWasTerminal: false,
      },
    }, tx);
    await refreshWorkspaceCheckInsForDates(actorId, [existing.plannedDate, createdTask.plannedDate], tx);

    const updatedChild = await getUpdatedTaskForResponse(tx, createdTask.id);
    return [updatedOriginal, updatedChild];
  });

  return {
    originalTask: serializeTask(originalTask),
    task: serializeTask(task),
  };
}

export async function convertStudyTaskToReview(
  id: string,
  input: ConvertTaskToReviewInput,
  actorId: string,
): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED", "SKIPPED"]);
    await applyTaskCas(tx, existing, {
      type: "review",
      status: "TODO",
      debtStatus: "ACCEPTABLE",
      plannedDate: input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start,
      estimatedMinutes: input.estimatedMinutes ?? Math.min(90, Math.max(25, existing.estimatedMinutes)),
      reviewText: mergeTaskReviewText(existing.reviewText, input.reviewText, "改成复习任务：先复盘产出，再决定是否继续原任务"),
      completedAt: null,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_CONVERTED_TO_REVIEW", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "convert_review",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: normalizeTaskDebtReason(input.reviewText, "改成复习任务：先复盘产出，再决定是否继续原任务"),
      metadata: {
        source: "task_convert_review_api",
        fromType: existing.type,
        toType: "review",
        fromPlannedDate: existing.plannedDate.toISOString(),
        toPlannedDate: updatedTask.plannedDate.toISOString(),
        fromEstimatedMinutes: existing.estimatedMinutes,
        toEstimatedMinutes: updatedTask.estimatedMinutes,
        previousCompletedAt: existing.completedAt?.toISOString() ?? null,
      },
    }, tx);
    await refreshWorkspaceCheckInsForDates(actorId, [existing.plannedDate, updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}
