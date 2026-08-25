import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { refreshWorkspaceCheckInSnapshotForDate } from "./check-in-service";
import { getStudyDayRange } from "./date";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import { type TaskCasPreimage } from "./concurrency";
import { loadTaskUpdateSnapshotForWorkspace } from "./task-detail-service";
import type { UpdateTaskInput } from "./study-service-contracts";
import type { CheckInV2Dto } from "./check-in-service";
import type { StudyDbClient } from "./study-audit";
import type { StudyTaskDto } from "@/lib/contracts";

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type DbTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export async function assertSubjectExists(
  subjectId: string,
  workspaceId: string,
  client: StudyDbClient = prisma,
): Promise<void> {
  const subject = await client.subject.findFirst({
    where: { id: subjectId, workspaceId },
    select: { id: true, archivedAt: true },
  });

  if (!subject) {
    throw new ApiError("SUBJECT_NOT_FOUND", 404);
  }
  if (subject.archivedAt) throw new ApiError("SUBJECT_ARCHIVED", 409);
}

export interface TaskCommandPreimage extends TaskCasPreimage {
  subjectId: string;
  syllabusNodeId: string | null;
  relatedSyllabusNodeIds: string[];
  stagePlanIds: string[];
  knowledgePointIds: string[];
  parentTaskId: string | null;
  planMilestoneId: string | null;
  title: string;
  priority: DbTaskPriority;
  estimatedMinutes: number;
  actualMinutes: number;
  reviewText: string | null;
  reviewScheduleId: string | null;
}

export async function getTaskCommandPreimage(
  tx: Prisma.TransactionClient,
  id: string,
  actorId: string,
): Promise<TaskCommandPreimage> {
  const workspace = await resolveActiveWorkspace(actorId, tx);
  const task = await tx.studyTask.findFirst({
    where: { id, subject: { workspaceId: workspace.id } },
    select: {
      id: true,
      subjectId: true,
      syllabusNodeId: true,
      planMilestoneId: true,
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
      updatedAt: true,
      reviewScheduleId: true,
      relatedSyllabusNodes: {
        select: { syllabusNodeId: true },
        orderBy: { createdAt: "asc" },
      },
      stageLinks: {
        select: { stagePlanId: true },
        orderBy: { createdAt: "asc" },
      },
      knowledgePointLinks: {
        select: { knowledgePointId: true },
        orderBy: { createdAt: "asc" },
      },
      subject: { select: { archivedAt: true } },
    },
  });

  if (!task) throw new ApiError("TASK_NOT_FOUND", 404);
  const { subject, relatedSyllabusNodes, stageLinks, knowledgePointLinks, ...taskPreimage } = task;
  const preimage = {
    ...taskPreimage,
    relatedSyllabusNodeIds: relatedSyllabusNodes.map((relation) => relation.syllabusNodeId),
    stagePlanIds: stageLinks.map((relation) => relation.stagePlanId),
    knowledgePointIds: knowledgePointLinks.map((relation) => relation.knowledgePointId),
  };
  if (subject.archivedAt) throw new ApiError("SUBJECT_ARCHIVED", 409);

  // Read the task preimage before serializing workspace mutations so concurrent
  // commands still race against the same CAS predicate. Revalidate scope after
  // taking the lock to reject a workspace switch or subject archive in between.
  const lockedWorkspace = await lockActiveWorkspaceForWrite(tx, actorId);
  if (lockedWorkspace.id !== workspace.id) {
    throw new ApiError("TASK_STATE_CONFLICT", 409, { conflictFields: ["workspaceId"] });
  }
  const currentSubject = await tx.subject.findFirst({
    where: { id: preimage.subjectId, workspaceId: lockedWorkspace.id },
    select: { archivedAt: true },
  });
  if (!currentSubject) {
    throw new ApiError("TASK_STATE_CONFLICT", 409, { conflictFields: ["workspaceId", "subjectId"] });
  }
  if (currentSubject.archivedAt) throw new ApiError("SUBJECT_ARCHIVED", 409);
  return preimage;
}

export async function assertTaskUpdateExpectation(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  existing: TaskCommandPreimage,
  input: Pick<UpdateTaskInput, "expectedStatus" | "expectedUpdatedAt">,
): Promise<void> {
  const conflictFields: string[] = [];
  const expectedStatus = input.expectedStatus.toUpperCase() as DbTaskStatus;
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (existing.status !== expectedStatus) conflictFields.push("status");
  if (!Number.isFinite(expectedUpdatedAt.getTime()) || existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    conflictFields.push("updatedAt");
  }
  if (conflictFields.length > 0) {
    throw await taskUpdateConflict(tx, workspaceId, existing.id, conflictFields);
  }
}

export async function taskUpdateConflict(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  taskId: string,
  conflictFields: string[],
): Promise<ApiError> {
  const latest = await loadTaskUpdateSnapshotForWorkspace(tx, workspaceId, taskId);
  return new ApiError("TASK_STATE_CONFLICT", 409, {
    latest,
    conflictFields: Array.from(new Set(conflictFields)),
    workbench: "/roadmap/allocation",
  });
}

export function normalizeTaskRelatedNodeIds(nodeIds: string[]): string[] {
  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new ApiError("TASK_RELATED_SYLLABUS_DUPLICATE", 400);
  }
  return [...nodeIds].sort();
}

export function normalizeTaskStageIds(stagePlanIds: string[]): string[] {
  const normalized = stagePlanIds.map((id) => id.trim()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) {
    throw new ApiError("TASK_STAGE_DUPLICATE", 400);
  }
  return [...normalized].sort();
}

export function normalizeTaskKnowledgePointIds(knowledgePointIds: string[]): string[] {
  const normalized = knowledgePointIds.map((id) => id.trim()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) {
    throw new ApiError("TASK_KNOWLEDGE_POINT_DUPLICATE", 400);
  }
  return [...normalized].sort();
}

export function assertTaskSyllabusRelationsDistinct(primaryNodeId: string | null, relatedNodeIds: string[]): void {
  if (primaryNodeId && relatedNodeIds.includes(primaryNodeId)) {
    throw new ApiError("TASK_PRIMARY_RELATED_SYLLABUS_OVERLAP", 400);
  }
}

export async function assertActiveTaskRelations(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  subjectId: string,
  input: { syllabusNodeIds: string[]; planMilestoneId: string | null; stagePlanIds: string[] },
): Promise<void> {
  const syllabusNodeIds = Array.from(new Set(input.syllabusNodeIds));
  if (syllabusNodeIds.length > 0) {
    const nodes = await tx.syllabusNode.findMany({
      where: { id: { in: syllabusNodeIds }, subject: { workspaceId } },
      select: { id: true, subjectId: true, archivedAt: true },
    });
    if (nodes.length !== syllabusNodeIds.length || nodes.some((node) => node.subjectId !== subjectId || node.archivedAt)) {
      throw new ApiError("TASK_SYLLABUS_RELATION_INVALID", 409, {
        conflictFields: ["syllabusNodeId", "relatedSyllabusNodeIds"],
      });
    }
  }
  if (input.planMilestoneId) {
    const milestone = await tx.planMilestone.findFirst({
      where: { id: input.planMilestoneId, workspaceId },
      select: { subjectId: true, archivedAt: true },
    });
    if (!milestone || milestone.archivedAt || (milestone.subjectId && milestone.subjectId !== subjectId)) {
      throw new ApiError("TASK_MILESTONE_INVALID", 409, { conflictFields: ["planMilestoneId"] });
    }
  }
  const stagePlanIds = Array.from(new Set(input.stagePlanIds));
  if (stagePlanIds.length > 0) {
    const stagePlans = await tx.stagePlan.findMany({
      where: { id: { in: stagePlanIds }, workspaceId },
      select: { id: true, status: true },
    });
    if (
      stagePlans.length !== stagePlanIds.length
      || stagePlans.some((stagePlan) => stagePlan.status === "archived")
    ) {
      throw new ApiError("TASK_STAGE_RELATION_INVALID", 409, {
        conflictFields: ["stagePlanIds"],
      });
    }
  }
}

export async function assertActiveTaskKnowledgePoints(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  subjectId: string,
  knowledgePointIds: string[],
): Promise<void> {
  if (knowledgePointIds.length === 0) return;
  const points = await tx.knowledgePoint.findMany({
    where: {
      id: { in: knowledgePointIds },
      workspaceId,
      archivedAt: null,
      OR: [
        { primarySubjectId: subjectId },
        { relatedSubjects: { some: { subjectId } } },
      ],
    },
    select: { id: true },
  });
  if (points.length !== knowledgePointIds.length) {
    throw new ApiError("TASK_KNOWLEDGE_POINT_RELATION_INVALID", 409, {
      conflictFields: ["knowledgePointIds"],
    });
  }
}

export function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}


export async function getUpdatedTaskForResponse(tx: Prisma.TransactionClient, id: string) {
  const task = await tx.studyTask.findUnique({
    where: { id },
    include: {
      subject: true,
      syllabusNode: true,
      stageLinks: { include: { stagePlan: { select: { name: true } } } },
      knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
    },
  });
  if (!task) throw new ApiError("TASK_STATE_CONFLICT", 409);
  return task;
}


export function parseStudyTaskSnapshot(value: Prisma.JsonValue | undefined): StudyTaskDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.id === "string" && typeof value.title === "string"
    ? value as unknown as StudyTaskDto
    : null;
}

export async function refreshWorkspaceCheckInsForDates(
  actorId: string,
  targetDates: Array<Date | null | undefined>,
  tx: Prisma.TransactionClient,
): Promise<Map<number, CheckInV2Dto>> {
  const workspace = await resolveActiveWorkspace(actorId, tx);
  const uniqueDays = new Map<number, Date>();
  const refreshed = new Map<number, CheckInV2Dto>();
  for (const targetDate of targetDates) {
    if (!targetDate) continue;
    const day = getStudyDayRange(targetDate);
    uniqueDays.set(day.start.getTime(), day.start);
  }
  for (const targetDate of Array.from(uniqueDays.values()).sort((left, right) => left.getTime() - right.getTime())) {
    refreshed.set(
      targetDate.getTime(),
      await refreshWorkspaceCheckInSnapshotForDate(workspace.id, targetDate, tx),
    );
  }
  return refreshed;
}


export function mergeTaskReviewText(existing: string | null, note: string | undefined, fallback: string): string {
  const addition = note?.trim() || fallback;
  const merged = existing?.trim() ? `${existing.trim()}\n${addition}` : addition;
  return merged.slice(0, 2000);
}

export function normalizeTaskDebtReason(note: string | undefined, fallback: string): string {
  const normalized = note?.trim() ?? "";
  return normalized.length > 0 ? normalized.slice(0, 1000) : fallback;
}

export function toTaskDebtEventState(task: {
  status: DbTaskStatus;
  debtStatus: string;
}) {
  return {
    status: task.status,
    debtStatus: task.debtStatus,
  };
}

export function nextTaskUpdatedAt(current: Date): Date {
  return new Date(Math.max(Date.now(), current.getTime() + 1));
}

export function assertTaskSourceStatus(
  task: TaskCommandPreimage,
  allowed: DbTaskStatus[],
  requireIncomplete = false,
): void {
  if (!allowed.includes(task.status) || (requireIncomplete && task.completedAt !== null)) {
    throw new ApiError("TASK_STATE_CONFLICT", 409);
  }
}
