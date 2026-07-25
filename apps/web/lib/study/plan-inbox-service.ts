import {
  assertExpectedRevision,
  buildOriginIdentity,
  canConvertInboxItem,
  canDismissInboxItem,
  canReopenInboxItem,
  validateDependencyEdge,
  wouldCreateDependencyCycle,
  type PlanInboxItemStatus,
  type TaskDependencyType,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { resolveActiveWorkspace, workspaceLockNamespace } from "./exam-workspace-service";
import { refreshWorkspaceCheckInSnapshotForDate } from "./check-in-service";

type PlanInboxRow = Prisma.PlanInboxItemGetPayload<{ include: { dependencyRefs: true } }>;

export interface PlanInboxWriteResult {
  item: PlanInboxItemDto;
  created: boolean;
  reused: boolean;
  superseded: PlanInboxItemDto[];
}

export interface CreatePlanInboxItemInput {
  stableKey: string;
  originKey: string;
  originVersion: number;
  originType: string;
  originSnapshot: Record<string, unknown>;
  title: string;
  subjectId?: string | null;
  plannedDate?: string | null;
  estimatedMinutes?: number | null;
  priority?: string | null;
  type?: string | null;
  planMilestoneId?: string | null;
  primaryNodeId?: string | null;
  relatedNodeIds?: string[];
  predecessorTasks?: Array<{ taskId: string; dependencyType: TaskDependencyType }>;
}

export interface PlanInboxDependencyRefDto {
  id: string;
  targetType: "TASK" | "INBOX_STABLE_REF";
  dependencyType: TaskDependencyType;
  taskId: string | null;
  planStableKey: string | null;
  planOriginVersion: number | null;
}

export interface PlanInboxItemDto {
  id: string;
  workspaceId: string;
  stableKey: string;
  originKey: string;
  originVersion: number;
  originType: string;
  originSnapshot: unknown;
  status: PlanInboxItemStatus;
  title: string;
  subjectId: string | null;
  plannedDate: string | null;
  estimatedMinutes: number | null;
  priority: string | null;
  type: string | null;
  planMilestoneId: string | null;
  primaryNodeId: string | null;
  relatedNodeIds: string[];
  dependencyRefs: PlanInboxDependencyRefDto[];
  missingFields: string[];
  requiredMilestoneKey: string | null;
  revision: number;
  convertedTaskId: string | null;
  supersededByItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseStringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))) : [];
}

function missingFields(row: Pick<PlanInboxRow, "title" | "subjectId" | "plannedDate" | "estimatedMinutes" | "planMilestoneId">, requiredMilestoneKey?: string | null): string[] {
  const missing: string[] = [];
  if (!row.title.trim()) missing.push("title");
  if (!row.subjectId) missing.push("subjectId");
  if (!row.plannedDate) missing.push("plannedDate");
  if (!row.estimatedMinutes || row.estimatedMinutes < 1) missing.push("estimatedMinutes");
  if (requiredMilestoneKey && !row.planMilestoneId) missing.push("planMilestoneId");
  return missing;
}

function serialize(row: PlanInboxRow): PlanInboxItemDto {
  const snapshot = typeof row.originSnapshot === "object" && row.originSnapshot && !Array.isArray(row.originSnapshot)
    ? row.originSnapshot as Record<string, unknown>
    : {};
  const requiredMilestoneKey = typeof snapshot.milestoneKey === "string" && snapshot.milestoneKey.trim() ? snapshot.milestoneKey : null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    stableKey: row.stableKey,
    originKey: row.originKey,
    originVersion: row.originVersion,
    originType: row.originType,
    originSnapshot: row.originSnapshot,
    status: row.status,
    title: row.title,
    subjectId: row.subjectId,
    plannedDate: row.plannedDate?.toISOString() ?? null,
    estimatedMinutes: row.estimatedMinutes,
    priority: row.priority,
    type: row.type,
    planMilestoneId: row.planMilestoneId,
    primaryNodeId: row.primaryNodeId,
    relatedNodeIds: parseStringArray(row.relatedNodeIds),
    dependencyRefs: row.dependencyRefs.map((ref) => ({
      id: ref.id,
      targetType: ref.targetType,
      dependencyType: ref.dependencyType,
      taskId: ref.taskId,
      planStableKey: ref.planStableKey,
      planOriginVersion: ref.planOriginVersion,
    })),
    missingFields: missingFields(row, requiredMilestoneKey),
    requiredMilestoneKey,
    revision: row.revision,
    convertedTaskId: row.convertedTaskId,
    supersededByItemId: row.supersededByItemId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listPlanInboxItems(
  actorId: string,
  status?: PlanInboxItemStatus,
): Promise<PlanInboxItemDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const rows = await prisma.planInboxItem.findMany({
    where: {
      workspaceId: workspace.id,
      ...(status ? { status } : {}),
    },
    include: { dependencyRefs: true },
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map(serialize);
}

export async function createPlanInboxItem(
  actorId: string,
  input: CreatePlanInboxItemInput,
): Promise<PlanInboxItemDto> {
  const workspace = await resolveActiveWorkspace(actorId);

  try {
    const result = await prisma.$transaction((tx) => createPlanInboxItemWithResult(tx, workspace.id, actorId, input));
    return result.item;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const origin = buildOriginIdentity({ originKey: input.originKey, originVersion: input.originVersion });
      const existing = await prisma.planInboxItem.findFirst({
        where: {
          workspaceId: workspace.id,
          originKey: origin.originKey,
          originVersion: origin.originVersion,
        },
        include: { dependencyRefs: true },
      });
      if (existing) return serialize(existing);
    }
    throw error;
  }
}

/**
 * 在报告、阶段和其他批次确认事务中使用的领域幂等入箱命令。
 * 相同 originKey + originVersion 复用原项目；创建新版本时只替代仍可转换的 OPEN 旧版本。
 */
export async function createPlanInboxItemWithResult(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  input: CreatePlanInboxItemInput,
): Promise<PlanInboxWriteResult> {
  const origin = buildOriginIdentity({ originKey: input.originKey, originVersion: input.originVersion });
  const existing = await tx.planInboxItem.findFirst({
    where: { workspaceId, originKey: origin.originKey, originVersion: origin.originVersion },
    include: { dependencyRefs: true },
  });
  if (existing) {
    return { item: serialize(existing), created: false, reused: true, superseded: [] };
  }

  await assertEditableRelations(tx, workspaceId, {
    subjectId: input.subjectId ?? null,
    planMilestoneId: input.planMilestoneId ?? null,
    primaryNodeId: input.primaryNodeId ?? null,
    relatedNodeIds: input.relatedNodeIds ?? [],
    predecessorTasks: input.predecessorTasks ?? [],
  });

  const created = await tx.planInboxItem.create({
    data: {
      workspaceId,
      stableKey: input.stableKey.trim(),
      originKey: origin.originKey,
      originVersion: origin.originVersion,
      originType: input.originType,
      originSnapshot: input.originSnapshot as Prisma.InputJsonValue,
      title: input.title.trim(),
      subjectId: input.subjectId ?? null,
      plannedDate: input.plannedDate ? new Date(input.plannedDate) : null,
      estimatedMinutes: input.estimatedMinutes ?? null,
      priority: input.priority ?? null,
      type: input.type ?? null,
      planMilestoneId: input.planMilestoneId ?? null,
      primaryNodeId: input.primaryNodeId ?? null,
      relatedNodeIds: input.relatedNodeIds?.length ? input.relatedNodeIds : undefined,
      actorId,
      dependencyRefs: input.predecessorTasks?.length
        ? { create: input.predecessorTasks.map((dependency) => ({ targetType: "TASK", taskId: dependency.taskId, dependencyType: dependency.dependencyType })) }
        : undefined,
    },
    include: { dependencyRefs: true },
  });

  const previous = await tx.planInboxItem.findMany({
    where: {
      workspaceId,
      originKey: origin.originKey,
      originVersion: { lt: origin.originVersion },
      status: "OPEN",
      supersededByItemId: null,
    },
    include: { dependencyRefs: true },
  });
  if (previous.length) {
    await tx.planInboxItem.updateMany({
      where: { id: { in: previous.map((item) => item.id) } },
      data: { supersededByItemId: created.id, revision: { increment: 1 } },
    });
  }
  const superseded = previous.map((item) => serialize({ ...item, supersededByItemId: created.id, revision: item.revision + 1 }));
  return { item: serialize(created), created: true, reused: false, superseded };
}

export async function updatePlanInboxItem(
  actorId: string,
  itemId: string,
  input: {
    expectedRevision: number;
    title?: string;
    plannedDate?: string | null;
    estimatedMinutes?: number | null;
    priority?: string | null;
    type?: string | null;
    planMilestoneId?: string | null;
    primaryNodeId?: string | null;
    subjectId?: string | null;
    relatedNodeIds?: string[];
    predecessorTasks?: Array<{ taskId: string; dependencyType: TaskDependencyType }>;
  },
): Promise<PlanInboxItemDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  return prisma.$transaction(async (tx) => {
    await lockInboxItem(tx, itemId);
    const existing = await tx.planInboxItem.findFirst({ where: { id: itemId, workspaceId: workspace.id }, include: { dependencyRefs: true } });
    if (!existing) throw new ApiError("PLAN_INBOX_ITEM_NOT_FOUND", 404);
    if (existing.supersededByItemId) throw new ApiError("PLAN_INBOX_SUPERSEDED", 409);
    if (existing.status === "CONVERTED") throw new ApiError("PLAN_INBOX_ALREADY_CONVERTED", 409);
    if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) === "revision_conflict") {
      throw new ApiError("PLAN_INBOX_REVISION_CONFLICT", 409, { latest: serialize(existing), conflictFields: ["revision"] });
    }
    const subjectId = input.subjectId === undefined ? existing.subjectId : input.subjectId;
    const relatedNodeIds = input.relatedNodeIds ?? parseStringArray(existing.relatedNodeIds);
    await assertEditableRelations(tx, workspace.id, {
      subjectId,
      planMilestoneId: input.planMilestoneId === undefined ? existing.planMilestoneId : input.planMilestoneId,
      primaryNodeId: input.primaryNodeId === undefined ? existing.primaryNodeId : input.primaryNodeId,
      relatedNodeIds,
      predecessorTasks: input.predecessorTasks ?? existing.dependencyRefs.filter((ref) => ref.targetType === "TASK" && ref.taskId).map((ref) => ({ taskId: ref.taskId as string, dependencyType: ref.dependencyType })),
    });
    if (input.predecessorTasks) {
      await tx.planInboxDependencyRef.deleteMany({ where: { inboxItemId: existing.id, targetType: "TASK" } });
      if (input.predecessorTasks.length) await tx.planInboxDependencyRef.createMany({ data: input.predecessorTasks.map((dependency) => ({ inboxItemId: existing.id, targetType: "TASK", taskId: dependency.taskId, dependencyType: dependency.dependencyType })) });
    }
    const updated = await tx.planInboxItem.update({
      where: { id: existing.id },
      data: {
        title: input.title?.trim(), subjectId,
        plannedDate: input.plannedDate === undefined ? undefined : input.plannedDate ? new Date(input.plannedDate) : null,
        estimatedMinutes: input.estimatedMinutes, priority: input.priority, type: input.type,
        planMilestoneId: input.planMilestoneId, primaryNodeId: input.primaryNodeId,
        relatedNodeIds: input.relatedNodeIds ? input.relatedNodeIds : undefined,
        revision: { increment: 1 },
      },
      include: { dependencyRefs: true },
    });
    return serialize(updated);
  });
}

export async function dismissPlanInboxItem(
  actorId: string,
  itemId: string,
  expectedRevision: number,
): Promise<PlanInboxItemDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  return prisma.$transaction(async (tx) => {
    await lockInboxItem(tx, itemId);
    const existing = await tx.planInboxItem.findFirst({ where: { id: itemId, workspaceId: workspace.id }, include: { dependencyRefs: true } });
    if (!existing) throw new ApiError("PLAN_INBOX_ITEM_NOT_FOUND", 404);
    if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision }) === "revision_conflict") {
      throw new ApiError("PLAN_INBOX_REVISION_CONFLICT", 409, { latest: serialize(existing), conflictFields: ["revision"] });
    }
    const gate = canDismissInboxItem({ status: existing.status, supersededByItemId: existing.supersededByItemId });
    if (gate !== "ok") throw new ApiError(`PLAN_INBOX_${gate.toUpperCase()}`, 409);
    const updated = await tx.planInboxItem.update({
      where: { id: existing.id }, data: { status: "DISMISSED", dismissedAt: new Date(), revision: { increment: 1 } },
      include: { dependencyRefs: true },
    });
    return serialize(updated);
  });
}

export async function reopenPlanInboxItem(
  actorId: string,
  itemId: string,
  expectedRevision: number,
): Promise<PlanInboxItemDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  return prisma.$transaction(async (tx) => {
    await lockInboxItem(tx, itemId);
    const existing = await tx.planInboxItem.findFirst({ where: { id: itemId, workspaceId: workspace.id }, include: { dependencyRefs: true } });
    if (!existing) throw new ApiError("PLAN_INBOX_ITEM_NOT_FOUND", 404);
    if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision }) === "revision_conflict") {
      throw new ApiError("PLAN_INBOX_REVISION_CONFLICT", 409, { latest: serialize(existing), conflictFields: ["revision"] });
    }
    const newer = await tx.planInboxItem.findFirst({ where: { workspaceId: workspace.id, originKey: existing.originKey, originVersion: { gt: existing.originVersion } }, include: { dependencyRefs: true }, orderBy: { originVersion: "desc" } });
    if (newer) throw new ApiError("PLAN_INBOX_SUPERSEDED", 409, { latest: serialize(newer), conflictFields: ["originVersion"] });
    const gate = canReopenInboxItem({ status: existing.status, supersededByItemId: existing.supersededByItemId });
    if (gate !== "ok") throw new ApiError(`PLAN_INBOX_${gate.toUpperCase()}`, 409);
    const updated = await tx.planInboxItem.update({
      where: { id: existing.id }, data: { status: "OPEN", dismissedAt: null, revision: { increment: 1 } },
      include: { dependencyRefs: true },
    });
    return serialize(updated);
  });
}

export async function convertPlanInboxItem(
  actorId: string,
  itemId: string,
  input: {
    expectedRevision: number;
    reviewScheduleId?: string | null;
    idempotencyKey?: string;
  },
): Promise<PlanInboxItemDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const idempotencyKey = input.idempotencyKey ?? `plan-inbox-convert:${itemId}`;

  return prisma.$transaction(async (tx) => {
    await lockInboxItem(tx, itemId);
    const existing = await tx.planInboxItem.findFirst({
      where: { id: itemId, workspaceId: workspace.id },
      include: { dependencyRefs: true },
    });
    if (!existing) throw new ApiError("PLAN_INBOX_ITEM_NOT_FOUND", 404);

    if (existing.status === "CONVERTED" && existing.convertedTaskId) {
      const matchingAudit = await tx.auditEvent.findFirst({
        where: {
          action: "PLAN_INBOX_CONVERTED",
          entityType: "PlanInboxItem",
          entityId: existing.id,
          metadata: { path: ["idempotencyKey"], equals: idempotencyKey },
        },
      });
      if (matchingAudit) return serialize(existing);
      throw new ApiError("PLAN_INBOX_ALREADY_CONVERTED", 409, {
        latest: serialize(existing),
        conflictFields: ["idempotencyKey"],
      });
    }
    if (
      assertExpectedRevision({
        currentRevision: existing.revision,
        expectedRevision: input.expectedRevision,
      }) === "revision_conflict"
    ) {
      throw new ApiError("PLAN_INBOX_REVISION_CONFLICT", 409, {
        latest: serialize(existing),
        conflictFields: ["revision"],
      });
    }

    const newer = await tx.planInboxItem.findFirst({
      where: { workspaceId: workspace.id, originKey: existing.originKey, originVersion: { gt: existing.originVersion } },
      include: { dependencyRefs: true },
      orderBy: { originVersion: "desc" },
    });
    if (newer) throw new ApiError("PLAN_INBOX_SUPERSEDED", 409, { latest: serialize(newer), conflictFields: ["originVersion"] });
    const originArchived = await isOriginArchived(tx, workspace.id, existing);
    const gate = canConvertInboxItem({
      status: existing.status,
      supersededByItemId: existing.supersededByItemId,
      originArchived,
    });
    if (gate !== "ok") throw new ApiError(`PLAN_INBOX_${gate.toUpperCase()}`, 409);

    const snapshot = typeof existing.originSnapshot === "object" && existing.originSnapshot && !Array.isArray(existing.originSnapshot)
      ? existing.originSnapshot as Record<string, unknown>
      : {};
    const requiredMilestoneKey = typeof snapshot.milestoneKey === "string" && snapshot.milestoneKey.trim() ? snapshot.milestoneKey : null;
    const missing = missingFields(existing, requiredMilestoneKey);
    if (missing.length) throw new ApiError("PLAN_INBOX_INCOMPLETE", 400, { conflictFields: missing });
    const subjectId = existing.subjectId as string;
    const plannedDate = existing.plannedDate as Date;
    const estimatedMinutes = existing.estimatedMinutes as number;
    await assertEditableRelations(tx, workspace.id, {
      subjectId,
      planMilestoneId: existing.planMilestoneId,
      primaryNodeId: existing.primaryNodeId,
      relatedNodeIds: parseStringArray(existing.relatedNodeIds),
      predecessorTasks: existing.dependencyRefs.filter((ref) => ref.targetType === "TASK" && ref.taskId).map((ref) => ({ taskId: ref.taskId as string, dependencyType: ref.dependencyType })),
    });

    const reviewScheduleId: string | null = input.reviewScheduleId ?? null;
    if (reviewScheduleId) {
      const schedule = await tx.reviewSchedule.findFirst({
        where: { id: reviewScheduleId, workspaceId: workspace.id },
      });
      if (!schedule) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
    }

    const normalizedPriority = existing.priority?.toUpperCase();
    const priority = normalizedPriority === "LOW" || normalizedPriority === "MEDIUM" || normalizedPriority === "HIGH" || normalizedPriority === "CRITICAL"
      ? normalizedPriority
      : "MEDIUM";

    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${workspaceLockNamespace}, ${hashLockKey(workspace.id)})`;
    const resolvedDependencies = await resolveDependencyRefs(tx, workspace.id, existing);
    const graph = await tx.taskDependency.findMany({
      where: { predecessor: { subject: { workspaceId: workspace.id } }, successor: { subject: { workspaceId: workspace.id } } },
      select: { predecessorId: true, successorId: true, type: true },
    });

    const task = await tx.studyTask.create({
      data: {
        subjectId,
        syllabusNodeId: existing.primaryNodeId,
        planMilestoneId: existing.planMilestoneId,
        title: existing.title.trim(),
        type: existing.type?.trim() || "focus",
        priority,
        plannedDate,
        estimatedMinutes,
        reviewScheduleId,
        relatedSyllabusNodes: parseStringArray(existing.relatedNodeIds).length ? {
          createMany: { data: parseStringArray(existing.relatedNodeIds).map((syllabusNodeId) => ({ syllabusNodeId })) },
        } : undefined,
      },
    });

    for (const dependency of resolvedDependencies) {
      const edgeCheck = validateDependencyEdge({ predecessorId: dependency.taskId, successorId: task.id, existing: graph });
      if (edgeCheck === "self_loop") throw new ApiError("DEPENDENCY_SELF_LOOP", 400);
      if (edgeCheck === "duplicate_edge") throw new ApiError("DEPENDENCY_DUPLICATE", 409);
      if (wouldCreateDependencyCycle({ edges: graph, predecessorId: dependency.taskId, successorId: task.id })) {
        throw new ApiError("DEPENDENCY_CYCLE", 409);
      }
      await tx.taskDependency.create({ data: { predecessorId: dependency.taskId, successorId: task.id, type: dependency.dependencyType, actorId } });
      graph.push({ predecessorId: dependency.taskId, successorId: task.id, type: dependency.dependencyType });
    }

    const updated = await tx.planInboxItem.update({
      where: { id: existing.id },
      data: {
        status: "CONVERTED",
        convertedTaskId: task.id,
        convertedAt: new Date(),
        revision: { increment: 1 },
      },
      include: { dependencyRefs: true },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "PLAN_INBOX_CONVERTED",
        entityType: "PlanInboxItem",
        entityId: existing.id,
        metadata: { taskId: task.id, reviewScheduleId, idempotencyKey, dependencyCount: resolvedDependencies.length },
      },
    });

    await refreshWorkspaceCheckInSnapshotForDate(workspace.id, plannedDate, tx);

    return serialize(updated);
  });
}

export interface PlanInboxFormOptions {
  subjects: Array<{ id: string; name: string }>;
  nodes: Array<{ id: string; subjectId: string; title: string }>;
  milestones: Array<{ id: string; subjectId: string | null; title: string }>;
  tasks: Array<{ id: string; subjectId: string; title: string }>;
  stagePlans: Array<{ id: string; name: string }>;
}

export async function getPlanInboxFormOptions(actorId: string): Promise<PlanInboxFormOptions> {
  const workspace = await resolveActiveWorkspace(actorId);
  const [subjects, nodes, milestones, tasks, stagePlans] = await Promise.all([
    prisma.subject.findMany({ where: { workspaceId: workspace.id, archivedAt: null }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
    prisma.syllabusNode.findMany({ where: { subject: { workspaceId: workspace.id }, archivedAt: null }, select: { id: true, subjectId: true, title: true }, orderBy: { title: "asc" } }),
    prisma.planMilestone.findMany({ where: { workspaceId: workspace.id, archivedAt: null }, select: { id: true, subjectId: true, title: true }, orderBy: { sortOrder: "asc" } }),
    prisma.studyTask.findMany({ where: { subject: { workspaceId: workspace.id }, status: { notIn: ["DONE", "SKIPPED"] } }, select: { id: true, subjectId: true, title: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.stagePlan.findMany({ where: { workspaceId: workspace.id, status: { in: ["active", "draft"] } }, select: { id: true, name: true }, orderBy: [{ status: "asc" }, { startDate: "asc" }] }),
  ]);
  return { subjects, nodes, milestones, tasks, stagePlans };
}

async function lockInboxItem(tx: Prisma.TransactionClient, itemId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM "PlanInboxItem" WHERE "id" = ${itemId} FOR UPDATE`;
}

function hashLockKey(workspaceId: string): number {
  let hash = 0;
  for (let index = 0; index < workspaceId.length; index += 1) hash = (hash * 31 + workspaceId.charCodeAt(index)) | 0;
  return hash;
}

async function assertEditableRelations(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  input: {
    subjectId: string | null;
    planMilestoneId: string | null;
    primaryNodeId: string | null;
    relatedNodeIds: string[];
    predecessorTasks: Array<{ taskId: string; dependencyType: TaskDependencyType }>;
  },
): Promise<void> {
  if (!input.subjectId) return;
  const subject = await tx.subject.findFirst({ where: { id: input.subjectId, workspaceId, archivedAt: null }, select: { id: true } });
  if (!subject) throw new ApiError("PLAN_INBOX_SUBJECT_INVALID", 409);
  const nodeIds = Array.from(new Set([input.primaryNodeId, ...input.relatedNodeIds].filter((id): id is string => Boolean(id))));
  if (nodeIds.length) {
    const validNodes = await tx.syllabusNode.count({ where: { id: { in: nodeIds }, subjectId: input.subjectId, archivedAt: null } });
    if (validNodes !== nodeIds.length) throw new ApiError("PLAN_INBOX_NODE_INVALID", 409);
  }
  if (input.planMilestoneId) {
    const milestone = await tx.planMilestone.findFirst({ where: { id: input.planMilestoneId, workspaceId, archivedAt: null }, select: { subjectId: true } });
    if (!milestone || (milestone.subjectId && milestone.subjectId !== input.subjectId)) throw new ApiError("PLAN_INBOX_MILESTONE_INVALID", 409);
  }
  const predecessorIds = Array.from(new Set(input.predecessorTasks.map((dependency) => dependency.taskId)));
  if (predecessorIds.length) {
    const validTasks = await tx.studyTask.count({ where: { id: { in: predecessorIds }, subject: { workspaceId } } });
    if (validTasks !== predecessorIds.length) throw new ApiError("PLAN_INBOX_DEPENDENCY_INVALID", 409);
  }
}

async function resolveDependencyRefs(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  item: PlanInboxRow,
): Promise<Array<{ taskId: string; dependencyType: TaskDependencyType }>> {
  const resolved: Array<{ taskId: string; dependencyType: TaskDependencyType }> = [];
  for (const ref of item.dependencyRefs) {
    if (ref.targetType === "TASK" && ref.taskId) {
      resolved.push({ taskId: ref.taskId, dependencyType: ref.dependencyType });
      continue;
    }
    if (ref.targetType === "INBOX_STABLE_REF" && ref.planStableKey) {
      const predecessor = await tx.planInboxItem.findFirst({
        where: { workspaceId, stableKey: ref.planStableKey, ...(ref.planOriginVersion ? { originVersion: ref.planOriginVersion } : {}) },
        include: { dependencyRefs: true },
      });
      if (!predecessor?.convertedTaskId || predecessor.status !== "CONVERTED") {
        throw new ApiError("PLAN_INBOX_DEPENDENCY_UNRESOLVED", 409, {
          latest: predecessor ? serialize(predecessor) : undefined,
          conflictFields: ["dependencyRefs"],
        });
      }
      resolved.push({ taskId: predecessor.convertedTaskId, dependencyType: ref.dependencyType });
      continue;
    }
    throw new ApiError("PLAN_INBOX_DEPENDENCY_INVALID", 409, { conflictFields: ["dependencyRefs"] });
  }
  return Array.from(new Map(resolved.map((dependency) => [dependency.taskId, dependency])).values());
}

async function isOriginArchived(tx: Prisma.TransactionClient, workspaceId: string, item: PlanInboxRow): Promise<boolean> {
  const snapshot = typeof item.originSnapshot === "object" && item.originSnapshot && !Array.isArray(item.originSnapshot)
    ? item.originSnapshot as Record<string, unknown>
    : {};
  if (snapshot.sourceArchived === true || snapshot.archivedAt) return true;
  if (item.originType === "SIMULATION_LOSS" && typeof snapshot.examId === "string") {
    return !(await tx.simulationExam.findFirst({ where: { id: snapshot.examId, workspaceId }, select: { id: true } }));
  }
  if (item.originType === "PERIODIC_REPORT" && typeof snapshot.decisionId === "string") {
    return !(await tx.periodicReportDecision.findFirst({ where: { id: snapshot.decisionId, workspaceId }, select: { id: true } }));
  }
  if (item.originType === "STAGE_ADJUSTMENT" && typeof snapshot.draftId === "string") {
    return !(await tx.stageAdjustmentDraft.findFirst({ where: { id: snapshot.draftId, workspaceId }, select: { id: true } }));
  }
  if (item.originType === "DAILY_REVIEW_MINIMUM" && typeof snapshot.dailyReviewId === "string") {
    return !(await tx.dailyReview.findFirst({ where: { id: snapshot.dailyReviewId, workspaceId }, select: { id: true } }));
  }
  return false;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
