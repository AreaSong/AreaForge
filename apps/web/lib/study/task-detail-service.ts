import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import { serializeTask } from "./task-serializer";
import type { StudyTaskDto, TaskPriorityDto, TaskStatusDto } from "./types";

type TaskDetailReadClient = Pick<Prisma.TransactionClient, "studyTask">;

export interface TaskUpdateSnapshotDto {
  id: string;
  subjectId: string;
  syllabusNodeId: string | null;
  relatedSyllabusNodeIds: string[];
  planMilestoneId: string | null;
  title: string;
  type: string;
  status: TaskStatusDto;
  priority: TaskPriorityDto;
  plannedDate: string;
  estimatedMinutes: number;
  reviewText: string | null;
  updatedAt: string;
}

export interface StudyTaskDetailDto {
  task: StudyTaskDto;
  workspaceId: string;
  workspaceName: string;
  readOnly: boolean;
  createdAt: string;
  updatedAt: string;
  subjectArchived: boolean;
  updateSnapshot: TaskUpdateSnapshotDto;
  planMilestone: {
    id: string;
    title: string;
    status: string;
    archivedAt: string | null;
  } | null;
  reviewSchedule: {
    id: string;
    status: string;
    dueDate: string | null;
    revision: number;
  } | null;
  relatedSyllabusNodes: Array<{
    id: string;
    title: string;
    archivedAt: string | null;
  }>;
  parentTask: TaskRelationSummaryDto | null;
  childTasks: TaskRelationSummaryDto[];
  sessions: Array<{
    id: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    effectiveMinutes: number;
    isEffective: boolean | null;
    minimalOutput: string | null;
  }>;
  debtEvents: Array<{
    id: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    reason: string | null;
    relatedTask: { id: string; title: string } | null;
    createdAt: string;
  }>;
  auditEvents: Array<{
    id: string;
    action: string;
    createdAt: string;
  }>;
}

export interface TaskRelationSummaryDto {
  id: string;
  title: string;
  status: TaskStatusDto;
}

export interface TaskDependencyCandidateDto extends TaskRelationSummaryDto {
  subjectName: string;
}

interface TaskUpdateSnapshotRow {
  id: string;
  subjectId: string;
  syllabusNodeId: string | null;
  planMilestoneId: string | null;
  title: string;
  type: string;
  status: string;
  priority: string;
  plannedDate: Date;
  estimatedMinutes: number;
  reviewText: string | null;
  updatedAt: Date;
  relatedSyllabusNodes: Array<{ syllabusNodeId: string }>;
}

export async function getStudyTaskDetail(actorId: string, taskId: string): Promise<StudyTaskDetailDto> {
  const [task, auditEvents] = await Promise.all([
    prisma.studyTask.findFirst({
      where: { id: taskId, subject: { workspace: { userId: actorId } } },
      include: {
        subject: {
          include: {
            workspace: { select: { id: true, name: true, status: true } },
          },
        },
        syllabusNode: true,
        relatedSyllabusNodes: {
          include: { syllabusNode: { select: { id: true, title: true, archivedAt: true } } },
          orderBy: { createdAt: "asc" },
        },
        planMilestone: { select: { id: true, title: true, status: true, archivedAt: true } },
        reviewSchedule: { select: { id: true, status: true, dueDate: true, revision: true } },
        parent: { select: { id: true, title: true, status: true } },
        children: {
          select: { id: true, title: true, status: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 50,
        },
        sessions: {
          select: {
            id: true,
            status: true,
            startedAt: true,
            endedAt: true,
            effectiveMinutes: true,
            isEffective: true,
            minimalOutput: true,
          },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: 50,
        },
        taskDebtEvents: {
          select: {
            id: true,
            action: true,
            fromStatus: true,
            toStatus: true,
            reason: true,
            createdAt: true,
            relatedTask: { select: { id: true, title: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 50,
        },
      },
    }),
    prisma.auditEvent.findMany({
      where: { actorId, entityType: "StudyTask", entityId: taskId },
      select: { id: true, action: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
  ]);

  if (!task?.subject.workspace) {
    throw new ApiError("TASK_NOT_FOUND", 404, { workbench: "/today/plan" });
  }

  return {
    task: serializeTask(task),
    workspaceId: task.subject.workspace.id,
    workspaceName: task.subject.workspace.name,
    readOnly: task.subject.workspace.status !== "ACTIVE",
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    subjectArchived: Boolean(task.subject.archivedAt),
    updateSnapshot: serializeTaskUpdateSnapshot(task),
    planMilestone: task.planMilestone ? {
      id: task.planMilestone.id,
      title: task.planMilestone.title,
      status: task.planMilestone.status,
      archivedAt: task.planMilestone.archivedAt?.toISOString() ?? null,
    } : null,
    reviewSchedule: task.reviewSchedule ? {
      id: task.reviewSchedule.id,
      status: task.reviewSchedule.status,
      dueDate: task.reviewSchedule.dueDate?.toISOString() ?? null,
      revision: task.reviewSchedule.revision,
    } : null,
    relatedSyllabusNodes: task.relatedSyllabusNodes.map(({ syllabusNode }) => ({
      id: syllabusNode.id,
      title: syllabusNode.title,
      archivedAt: syllabusNode.archivedAt?.toISOString() ?? null,
    })),
    parentTask: task.parent ? serializeTaskRelation(task.parent) : null,
    childTasks: task.children.map(serializeTaskRelation),
    sessions: task.sessions.map((session) => ({
      id: session.id,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      effectiveMinutes: session.effectiveMinutes,
      isEffective: session.isEffective,
      minimalOutput: session.minimalOutput,
    })),
    debtEvents: task.taskDebtEvents.map((event) => ({
      id: event.id,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      reason: event.reason,
      relatedTask: event.relatedTask,
      createdAt: event.createdAt.toISOString(),
    })),
    auditEvents: auditEvents.map((event) => ({
      id: event.id,
      action: event.action,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function getTaskUpdateSnapshot(actorId: string, taskId: string): Promise<TaskUpdateSnapshotDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const snapshot = await loadTaskUpdateSnapshotForWorkspace(prisma, workspace.id, taskId);
  if (!snapshot) throw new ApiError("TASK_NOT_FOUND", 404, { workbench: "/today/plan" });
  return snapshot;
}

export async function loadTaskUpdateSnapshotForWorkspace(
  client: TaskDetailReadClient,
  workspaceId: string,
  taskId: string,
): Promise<TaskUpdateSnapshotDto | null> {
  const task = await client.studyTask.findFirst({
    where: { id: taskId, subject: { workspaceId } },
    select: {
      id: true,
      subjectId: true,
      syllabusNodeId: true,
      planMilestoneId: true,
      title: true,
      type: true,
      status: true,
      priority: true,
      plannedDate: true,
      estimatedMinutes: true,
      reviewText: true,
      updatedAt: true,
      relatedSyllabusNodes: {
        select: { syllabusNodeId: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return task ? serializeTaskUpdateSnapshot(task) : null;
}

export function serializeTaskUpdateSnapshot(task: TaskUpdateSnapshotRow): TaskUpdateSnapshotDto {
  return {
    id: task.id,
    subjectId: task.subjectId,
    syllabusNodeId: task.syllabusNodeId,
    relatedSyllabusNodeIds: task.relatedSyllabusNodes.map((relation) => relation.syllabusNodeId),
    planMilestoneId: task.planMilestoneId,
    title: task.title,
    type: task.type,
    status: fromDbTaskStatus(task.status),
    priority: task.priority.toLowerCase() as TaskPriorityDto,
    plannedDate: task.plannedDate.toISOString(),
    estimatedMinutes: task.estimatedMinutes,
    reviewText: task.reviewText,
    updatedAt: task.updatedAt.toISOString(),
  };
}

export async function listTaskDependencyCandidates(
  actorId: string,
  taskId: string,
): Promise<TaskDependencyCandidateDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const tasks = await prisma.studyTask.findMany({
    where: {
      id: { not: taskId },
      subject: { workspaceId: workspace.id, archivedAt: null },
    },
    select: { id: true, title: true, status: true, subject: { select: { name: true } } },
    orderBy: [{ plannedDate: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    take: 200,
  });
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: fromDbTaskStatus(task.status),
    subjectName: task.subject.name,
  }));
}

function serializeTaskRelation(task: { id: string; title: string; status: string }): TaskRelationSummaryDto {
  return { id: task.id, title: task.title, status: fromDbTaskStatus(task.status) };
}

function fromDbTaskStatus(status: string): TaskStatusDto {
  return status.toLowerCase() as TaskStatusDto;
}
