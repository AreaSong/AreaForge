import {
  isHardBlocked,
  validateDependencyEdge,
  wouldCreateDependencyCycle,
  type TaskDependencyType,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { workspaceOwnerWhere } from "@/lib/workspace/access-service";
import type { TaskDependencyDto } from "@/lib/contracts/task";
import { fromDbTaskStatus, type DbTaskStatus } from "./task-serializer";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";

export type { TaskDependencyDto } from "@/lib/contracts/task";

const dependencyGraphLockNamespace = 2026072113;
type DependencyReadClient = Pick<Prisma.TransactionClient, "studyTask" | "taskDependency">;

function serialize(row: {
  id: string;
  predecessorId: string;
  successorId: string;
  type: TaskDependencyType;
  revision: number;
  predecessor?: { title: string; status: DbTaskStatus };
  successor?: { title: string; status: DbTaskStatus };
}): TaskDependencyDto {
  return {
    id: row.id,
    predecessorId: row.predecessorId,
    successorId: row.successorId,
    type: row.type,
    revision: row.revision,
    predecessorTitle: row.predecessor?.title ?? null,
    predecessorStatus: row.predecessor ? fromDbTaskStatus(row.predecessor.status) : null,
    successorTitle: row.successor?.title ?? null,
    successorStatus: row.successor ? fromDbTaskStatus(row.successor.status) : null,
  };
}

function hashLockKey(workspaceId: string): number {
  let hash = 0;
  for (let i = 0; i < workspaceId.length; i += 1) {
    hash = (hash * 31 + workspaceId.charCodeAt(i)) | 0;
  }
  return hash;
}

async function assertTaskInActiveWorkspaceScope(
  client: DependencyReadClient,
  taskId: string,
  workspaceId: string,
  requireActiveSubject = true,
) {
  const task = await client.studyTask.findFirst({
    where: { id: taskId, subject: { workspaceId } },
    include: { subject: { select: { workspaceId: true, archivedAt: true } } },
  });
  if (!task) throw new ApiError("TASK_NOT_FOUND", 404);
  if (requireActiveSubject && task.subject.archivedAt) throw new ApiError("SUBJECT_ARCHIVED", 409);
  return task;
}

export async function lockWorkspaceDependencyGraph(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${dependencyGraphLockNamespace}, ${hashLockKey(workspaceId)})`;
}

export async function listTaskDependencies(actorId: string, taskId: string): Promise<TaskDependencyDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  await assertTaskInActiveWorkspaceScope(prisma, taskId, workspace.id, false);
  return loadTaskDependencies(taskId, workspace.id);
}

export async function listOwnedTaskDependencies(actorId: string, taskId: string): Promise<TaskDependencyDto[]> {
  const task = await prisma.studyTask.findFirst({
    where: { id: taskId, subject: { workspace: workspaceOwnerWhere(actorId) } },
    select: { subject: { select: { workspaceId: true } } },
  });
  const workspaceId = task?.subject.workspaceId;
  if (!workspaceId) throw new ApiError("TASK_NOT_FOUND", 404);
  return loadTaskDependencies(taskId, workspaceId);
}

async function loadTaskDependencies(taskId: string, workspaceId: string): Promise<TaskDependencyDto[]> {
  const rows = await prisma.taskDependency.findMany({
    where: {
      AND: [
        { OR: [{ predecessorId: taskId }, { successorId: taskId }] },
        { predecessor: { subject: { workspaceId } } },
        { successor: { subject: { workspaceId } } },
      ],
    },
    include: {
      predecessor: { select: { title: true, status: true } },
      successor: { select: { title: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(serialize);
}

export async function createTaskDependency(
  actorId: string,
  input: {
    predecessorId: string;
    successorId: string;
    type?: TaskDependencyType;
  },
): Promise<TaskDependencyDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    await lockWorkspaceDependencyGraph(tx, workspace.id);

    await assertTaskInActiveWorkspaceScope(tx, input.predecessorId, workspace.id);
    await assertTaskInActiveWorkspaceScope(tx, input.successorId, workspace.id);

    const existing = await tx.taskDependency.findMany({
      where: {
        predecessor: { subject: { workspaceId: workspace.id } },
        successor: { subject: { workspaceId: workspace.id } },
      },
      select: { predecessorId: true, successorId: true, type: true },
    });
    const edgeCheck = validateDependencyEdge({
      predecessorId: input.predecessorId,
      successorId: input.successorId,
      existing,
    });
    if (edgeCheck === "self_loop") throw new ApiError("DEPENDENCY_SELF_LOOP", 400);
    if (edgeCheck === "duplicate_edge") throw new ApiError("DEPENDENCY_DUPLICATE", 409);

    if (
      wouldCreateDependencyCycle({
        edges: existing,
        predecessorId: input.predecessorId,
        successorId: input.successorId,
      })
    ) {
      throw new ApiError("DEPENDENCY_CYCLE", 409);
    }

    const created = await tx.taskDependency.create({
      data: {
        predecessorId: input.predecessorId,
        successorId: input.successorId,
        type: input.type ?? "SOFT",
        actorId,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "TASK_DEPENDENCY_CREATED",
        entityType: "TaskDependency",
        entityId: created.id,
      },
    });

    return serialize(created);
  });
}

export async function updateTaskDependencyType(
  actorId: string,
  dependencyId: string,
  input: { type: TaskDependencyType; expectedRevision: number },
): Promise<TaskDependencyDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    await lockWorkspaceDependencyGraph(tx, workspace.id);
    const existing = await tx.taskDependency.findFirst({ where: { id: dependencyId } });
    if (!existing) throw new ApiError("DEPENDENCY_NOT_FOUND", 404);
    await assertTaskInActiveWorkspaceScope(tx, existing.predecessorId, workspace.id);
    await assertTaskInActiveWorkspaceScope(tx, existing.successorId, workspace.id);
    if (existing.revision !== input.expectedRevision) {
      throw new ApiError("DEPENDENCY_REVISION_CONFLICT", 409, {
        latest: serialize(existing),
        conflictFields: ["revision"],
      });
    }
    const changed = await tx.taskDependency.updateMany({
      where: { id: dependencyId, revision: input.expectedRevision },
      data: { type: input.type, revision: { increment: 1 }, actorId },
    });
    if (changed.count !== 1) throw new ApiError("DEPENDENCY_REVISION_CONFLICT", 409, { conflictFields: ["revision"] });
    const updated = await tx.taskDependency.findUniqueOrThrow({ where: { id: dependencyId } });
    await tx.auditEvent.create({
      data: { actorId, action: "TASK_DEPENDENCY_UPDATED", entityType: "TaskDependency", entityId: dependencyId },
    });
    return serialize(updated);
  });
}

export async function deleteTaskDependency(
  actorId: string,
  dependencyId: string,
  expectedRevision: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    await lockWorkspaceDependencyGraph(tx, workspace.id);
    const existing = await tx.taskDependency.findFirst({ where: { id: dependencyId } });
    if (!existing) throw new ApiError("DEPENDENCY_NOT_FOUND", 404);
    await assertTaskInActiveWorkspaceScope(tx, existing.predecessorId, workspace.id);
    await assertTaskInActiveWorkspaceScope(tx, existing.successorId, workspace.id);
    if (existing.revision !== expectedRevision) {
      throw new ApiError("DEPENDENCY_REVISION_CONFLICT", 409, {
        latest: serialize(existing),
        conflictFields: ["revision"],
      });
    }
    const deleted = await tx.taskDependency.deleteMany({ where: { id: dependencyId, revision: expectedRevision } });
    if (deleted.count !== 1) throw new ApiError("DEPENDENCY_REVISION_CONFLICT", 409, { conflictFields: ["revision"] });
    await tx.auditEvent.create({
      data: { actorId, action: "TASK_DEPENDENCY_DELETED", entityType: "TaskDependency", entityId: dependencyId },
    });
  });
}

export async function assertSuccessorStartAllowed(
  successorId: string,
  client: DependencyReadClient = prisma,
): Promise<void> {
  const hardDeps = await client.taskDependency.findMany({
    where: { successorId, type: "HARD" },
    include: { predecessor: { select: { status: true } } },
  });
  for (const dep of hardDeps) {
    if (isHardBlocked({ predecessorStatus: dep.predecessor.status, dependencyType: "HARD" })) {
      throw new ApiError("HARD_DEPENDENCY_BLOCKED", 409);
    }
  }
}
