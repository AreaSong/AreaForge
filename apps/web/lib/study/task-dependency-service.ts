import {
  isHardBlocked,
  validateDependencyEdge,
  wouldCreateDependencyCycle,
  type TaskDependencyType,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { resolveActiveWorkspace, workspaceLockNamespace } from "./exam-workspace-service";

export interface TaskDependencyDto {
  id: string;
  predecessorId: string;
  successorId: string;
  type: TaskDependencyType;
  revision: number;
}

function serialize(row: {
  id: string;
  predecessorId: string;
  successorId: string;
  type: TaskDependencyType;
  revision: number;
}): TaskDependencyDto {
  return {
    id: row.id,
    predecessorId: row.predecessorId,
    successorId: row.successorId,
    type: row.type,
    revision: row.revision,
  };
}

function hashLockKey(workspaceId: string): number {
  let hash = 0;
  for (let i = 0; i < workspaceId.length; i += 1) {
    hash = (hash * 31 + workspaceId.charCodeAt(i)) | 0;
  }
  return hash;
}

async function assertTaskInActiveWorkspaceScope(taskId: string, workspaceId: string) {
  const task = await prisma.studyTask.findFirst({
    where: { id: taskId },
    include: { subject: { select: { workspaceId: true } } },
  });
  if (!task) throw new ApiError("TASK_NOT_FOUND", 404);
  if (task.subject.workspaceId && task.subject.workspaceId !== workspaceId) {
    throw new ApiError("TASK_WORKSPACE_MISMATCH", 409);
  }
  return task;
}

export async function listTaskDependencies(actorId: string, taskId: string): Promise<TaskDependencyDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  await assertTaskInActiveWorkspaceScope(taskId, workspace.id);
  const rows = await prisma.taskDependency.findMany({
    where: {
      OR: [{ predecessorId: taskId }, { successorId: taskId }],
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
  const workspace = await resolveActiveWorkspace(actorId);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${workspaceLockNamespace}, ${hashLockKey(workspace.id)})`;

    await assertTaskInActiveWorkspaceScope(input.predecessorId, workspace.id);
    await assertTaskInActiveWorkspaceScope(input.successorId, workspace.id);

    const existing = await tx.taskDependency.findMany({
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
  type: TaskDependencyType,
): Promise<TaskDependencyDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const existing = await prisma.taskDependency.findFirst({ where: { id: dependencyId } });
  if (!existing) throw new ApiError("DEPENDENCY_NOT_FOUND", 404);
  await assertTaskInActiveWorkspaceScope(existing.predecessorId, workspace.id);
  await assertTaskInActiveWorkspaceScope(existing.successorId, workspace.id);

  const updated = await prisma.taskDependency.update({
    where: { id: dependencyId },
    data: { type, revision: { increment: 1 }, actorId },
  });
  return serialize(updated);
}

export async function deleteTaskDependency(actorId: string, dependencyId: string): Promise<void> {
  const workspace = await resolveActiveWorkspace(actorId);
  const existing = await prisma.taskDependency.findFirst({ where: { id: dependencyId } });
  if (!existing) throw new ApiError("DEPENDENCY_NOT_FOUND", 404);
  await assertTaskInActiveWorkspaceScope(existing.predecessorId, workspace.id);
  await assertTaskInActiveWorkspaceScope(existing.successorId, workspace.id);
  await prisma.taskDependency.delete({ where: { id: dependencyId } });
}

export async function assertSuccessorStartAllowed(successorId: string): Promise<void> {
  const hardDeps = await prisma.taskDependency.findMany({
    where: { successorId, type: "HARD" },
    include: { predecessor: { select: { status: true } } },
  });
  for (const dep of hardDeps) {
    if (isHardBlocked({ predecessorStatus: dep.predecessor.status, dependencyType: "HARD" })) {
      throw new ApiError("HARD_DEPENDENCY_BLOCKED", 409);
    }
  }
}
