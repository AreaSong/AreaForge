import { createHash } from "node:crypto";
import type { PlanDraftAdvice } from "@areaforge/ai";
import {
  assertExpectedRevision,
  buildSimulationRemediationGroups,
  buildSimulationRemediationOriginSnapshot,
  buildOriginIdentity,
  canConvertInboxItem,
  canDismissInboxItem,
  canReopenInboxItem,
  stableStringify,
  validateDependencyEdge,
  wouldCreateDependencyCycle,
  type PlanInboxItemStatus,
  type SimulationLossReason,
  type TaskDependencyType,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getStudyDayRange } from "./date";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import { refreshWorkspaceCheckInSnapshotForDate } from "./check-in-service";
import { getBridgableReviewScheduleInTx } from "./review-schedule-service";
import { acknowledgeAiDraftResultInTx } from "./ai-draft-service";
import { lockWorkspaceDependencyGraph } from "./task-dependency-service";
import {
  buildPersistentCreateFingerprint,
  claimPersistentCreateCommand,
  completePersistentCreateClaim,
  normalizeIdempotencyKey,
  type PersistentCreateCommand,
} from "./persistent-idempotency";

type PlanInboxRow = Prisma.PlanInboxItemGetPayload<{ include: { dependencyRefs: true } }>;

const planInboxWorkbench = "/today/inbox";

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

export type CreateUserPlanInboxItemInput = Omit<
  CreatePlanInboxItemInput,
  "stableKey" | "originKey" | "originVersion" | "originType" | "originSnapshot"
> & {
  clientRequestKey: string;
};

export interface PlanInboxDependencyRefDto {
  id: string;
  targetType: "TASK" | "INBOX_STABLE_REF";
  dependencyType: TaskDependencyType;
  taskId: string | null;
  importBatchId: string | null;
  planStableKey: string | null;
  planOriginVersion: number | null;
}

export interface PlanInboxItemDto {
  id: string;
  workspaceId: string;
  stableKey: string;
  sourceStableKey: string;
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

interface PlanInboxRelationConflictLatest {
  kind: "plan-inbox-relations";
  item: null;
  relations: {
    subject: { id: string; archived: boolean } | null;
    planMilestone: { id: string; subjectId: string | null; archived: boolean } | null;
    nodes: Array<{ id: string; subjectId: string; archived: boolean }>;
    predecessorTasks: Array<{ id: string; subjectId: string; status: string; subjectArchived: boolean }>;
  };
}

export function matchesPlanInboxStableRef(
  item: Pick<PlanInboxItemDto, "stableKey" | "sourceStableKey" | "originVersion">,
  stableRef: string,
): boolean {
  return `${item.sourceStableKey}@${item.originVersion}` === stableRef
    || item.sourceStableKey === stableRef
    || `${item.stableKey}@${item.originVersion}` === stableRef
    || item.stableKey === stableRef;
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
    sourceStableKey: typeof snapshot.sourceStableKey === "string" && snapshot.sourceStableKey.trim()
      ? snapshot.sourceStableKey.trim()
      : row.stableKey,
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
      importBatchId: ref.importBatchId,
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

function isPlanInboxItemDto(value: unknown): value is PlanInboxItemDto {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PlanInboxItemDto>;
  return typeof candidate.id === "string"
    && typeof candidate.workspaceId === "string"
    && typeof candidate.originKey === "string"
    && typeof candidate.originVersion === "number"
    && (candidate.status === "OPEN" || candidate.status === "DISMISSED" || candidate.status === "CONVERTED")
    && typeof candidate.revision === "number"
    && Array.isArray(candidate.dependencyRefs);
}

async function withPlanInboxConflictContext<T>(
  actorId: string,
  itemId: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;

    const workspace = await resolveActiveWorkspace(actorId);
    const current = await prisma.planInboxItem.findFirst({
      where: { id: itemId, workspaceId: workspace.id },
      include: { dependencyRefs: true },
    });
    const suppliedLatest = isPlanInboxItemDto(error.details?.latest)
      ? error.details.latest
      : null;
    const successor = error.code === "PLAN_INBOX_SUPERSEDED" && current?.supersededByItemId
      ? await prisma.planInboxItem.findFirst({
          where: { id: current.supersededByItemId, workspaceId: workspace.id },
          include: { dependencyRefs: true },
        })
      : null;
    const latest = error.code === "PLAN_INBOX_SUPERSEDED" && (suppliedLatest || successor)
      ? suppliedLatest ?? serialize(successor as PlanInboxRow)
      : current
        ? serialize(current)
        : suppliedLatest;

    throw new ApiError(error.code, 409, {
      latest: latest ?? null,
      conflictFields: error.details?.conflictFields?.length
        ? error.details.conflictFields
        : planInboxConflictFields(error.code),
      workbench: planInboxWorkbench,
    });
  }
}

function planInboxConflictFields(code: string): string[] {
  const fieldsByCode: Record<string, string[]> = {
    ACTIVE_WORKSPACE_CHANGED: ["workspaceId"],
    DEPENDENCY_CYCLE: ["predecessorTasks"],
    DEPENDENCY_DUPLICATE: ["predecessorTasks"],
    PLAN_INBOX_ALREADY_CONVERTED: ["status", "convertedTaskId"],
    PLAN_INBOX_ALREADY_DISMISSED: ["status"],
    PLAN_INBOX_CONVERTED: ["status", "convertedTaskId"],
    PLAN_INBOX_CONVERSION_IN_PROGRESS: ["idempotencyKey"],
    PLAN_INBOX_CONVERSION_RESULT_UNAVAILABLE: ["idempotencyKey", "convertedTaskId"],
    PLAN_INBOX_DEPENDENCY_INVALID: ["predecessorTasks"],
    PLAN_INBOX_DEPENDENCY_UNRESOLVED: ["predecessorTasks"],
    PLAN_INBOX_IDEMPOTENCY_CONFLICT: ["idempotencyKey", "requestFingerprint"],
    PLAN_INBOX_MILESTONE_INVALID: ["planMilestoneId"],
    PLAN_INBOX_NODE_INVALID: ["primaryNodeId", "relatedNodeIds"],
    PLAN_INBOX_NODE_REQUIRES_SUBJECT: ["subjectId", "primaryNodeId", "relatedNodeIds"],
    PLAN_INBOX_NOT_DISMISSED: ["status"],
    PLAN_INBOX_NOT_OPEN: ["status"],
    PLAN_INBOX_ORIGIN_ARCHIVED: ["originSnapshot"],
    PLAN_INBOX_ORIGIN_STALE: ["originKey", "originVersion", "originSnapshot"],
    PLAN_INBOX_SUBJECT_INVALID: ["subjectId"],
    PLAN_INBOX_SUPERSEDED: ["originVersion", "supersededByItemId"],
    PLAN_INBOX_SUPERSEDE_CONFLICT: ["originVersion", "supersededByItemId"],
  };
  return fieldsByCode[code] ?? ["revision"];
}

function matchesImmutableInboxOrigin(row: PlanInboxRow, input: CreatePlanInboxItemInput): boolean {
  return row.stableKey === input.stableKey.trim()
    && row.originType === input.originType
    && stableStringify(row.originSnapshot) === stableStringify(input.originSnapshot);
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
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    return (await createPlanInboxItemWithResult(tx, workspace.id, actorId, input)).item;
  });
}

export async function createUserPlanInboxItem(
  actorId: string,
  input: CreateUserPlanInboxItemInput,
): Promise<PlanInboxItemDto> {
  const { clientRequestKey, ...content } = input;
  const requestKeyHash = createHash("sha256")
    .update(stableStringify({ actorId, clientRequestKey: clientRequestKey.trim() }))
    .digest("hex");
  const sourceKey = `user-created:${requestKeyHash}`;
  return createPlanInboxItem(actorId, {
    ...content,
    stableKey: sourceKey,
    originKey: sourceKey,
    originVersion: 1,
    originType: "USER_CREATED",
    originSnapshot: {
      provenanceVersion: 1,
      source: "USER_CREATED",
      clientRequestKeyHash: requestKeyHash,
    },
  });
}

export interface AdoptAiPlanDraftInput {
  operationId: string;
  projectionVersion: string;
  resultProof: string;
  tasks: Array<{
    title: string;
    plannedDate?: string | null;
    estimatedMinutes: number;
  }>;
}

export async function adoptAiPlanDraftToInbox(
  actorId: string,
  input: AdoptAiPlanDraftInput,
): Promise<PlanInboxItemDto[]> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const acknowledged = await acknowledgeAiDraftResultInTx(
      tx,
      actorId,
      workspace.id,
      "plan",
      input.resultProof,
      { operationId: input.operationId, projectionVersion: input.projectionVersion },
    );
    const proofDraft = acknowledged.response.draft as PlanDraftAdvice;
    if (!matchesAiPlanDraftTasks(proofDraft.tasks, input.tasks)) {
      throw new ApiError("AI_DRAFT_RESULT_MISMATCH", 409, {
        latest: {
          operationId: input.operationId,
          projectionVersion: input.projectionVersion,
          tasks: proofDraft.tasks,
        },
        conflictFields: ["tasks"],
        workbench: planInboxWorkbench,
      });
    }

    const operation = await tx.aiDraftOperation.findUnique({
      where: {
        workspaceId_operationId: {
          workspaceId: workspace.id,
          operationId: input.operationId,
        },
      },
    });
    if (!operation) throw new ApiError("AI_DRAFT_OPERATION_NOT_FOUND", 404, { workbench: planInboxWorkbench });
    if (
      operation.status !== "SUCCEEDED"
      || !operation.consumedAt
      || !operation.resultReference?.startsWith(`draft:plan:${operation.operationId}:`)
    ) {
      throw new ApiError("AI_DRAFT_OPERATION_NOT_ADOPTABLE", 409, {
        latest: {
          operationId: operation.operationId,
          revision: operation.revision,
          status: operation.status,
          consumedAt: operation.consumedAt?.toISOString() ?? null,
          resultReference: operation.resultReference,
        },
        conflictFields: ["status", "consumedAt", "resultReference"],
        workbench: planInboxWorkbench,
      });
    }
    if (operation.projectionVersion !== input.projectionVersion) {
      throw new ApiError("AI_DRAFT_PROJECTION_MISMATCH", 409, {
        latest: {
          operationId: operation.operationId,
          revision: operation.revision,
          status: operation.status,
          projectionVersion: operation.projectionVersion,
        },
        conflictFields: ["projectionVersion"],
        workbench: planInboxWorkbench,
      });
    }

    const writes: PlanInboxWriteResult[] = [];
    for (const [index, task] of input.tasks.entries()) {
      const originKey = `ai-plan:${operation.operationId}:${index}`;
      writes.push(await createPlanInboxItemWithResult(tx, workspace.id, actorId, {
        stableKey: originKey,
        originKey,
        originVersion: operation.revision,
        originType: "AI_PLAN",
        originSnapshot: {
          provenanceVersion: 1,
          source: "AI_PLAN",
          operationId: operation.operationId,
          operationRevision: operation.revision,
          projectionVersion: operation.projectionVersion,
          schemaVersion: "plan-draft-v1",
          taskIndex: index,
          taskCount: input.tasks.length,
        },
        title: task.title,
        plannedDate: task.plannedDate ?? null,
        estimatedMinutes: task.estimatedMinutes,
        priority: "MEDIUM",
        type: "focus",
      }));
    }
    if (writes.some((write) => write.created)) {
      await tx.auditEvent.create({
        data: {
          actorId,
          action: "AI_PLAN_ADOPTED_TO_INBOX",
          entityType: "AiDraftOperation",
          entityId: operation.id,
          metadata: {
            operationId: operation.operationId,
            operationRevision: operation.revision,
            itemCount: writes.length,
          },
        },
      });
    }
    return writes.map((write) => write.item);
  });
}

function matchesAiPlanDraftTasks(
  proofTasks: PlanDraftAdvice["tasks"],
  submittedTasks: AdoptAiPlanDraftInput["tasks"],
): boolean {
  return proofTasks.length === submittedTasks.length
    && proofTasks.every((task, index) => {
      const submitted = submittedTasks[index];
      return submitted !== undefined
        && task.title.trim() === submitted.title.trim()
        && task.estimatedMinutes === submitted.estimatedMinutes;
    });
}

export async function createLowConversionPlanInboxItem(
  actorId: string,
  input: { sessionId: string; expectedCloseoutVersion: number },
): Promise<PlanInboxItemDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const session = await tx.studySession.findFirst({
      where: { id: input.sessionId, subject: { workspaceId: workspace.id } },
      select: {
        id: true,
        status: true,
        closeoutVersion: true,
        isLowConversion: true,
        endedAt: true,
        requiredOutput: true,
        subjectId: true,
        syllabusNodeId: true,
        taskId: true,
        task: { select: { title: true } },
        subject: { select: { name: true, archivedAt: true } },
      },
    });
    if (!session) throw new ApiError("SESSION_NOT_FOUND", 404, { workbench: planInboxWorkbench });
    const latestSource = {
      sessionId: session.id,
      status: session.status,
      closeoutVersion: session.closeoutVersion,
      isLowConversion: session.isLowConversion,
      endedAt: session.endedAt?.toISOString() ?? null,
      subjectArchived: Boolean(session.subject.archivedAt),
    };
    if (session.subject.archivedAt) {
      throw new ApiError("SUBJECT_ARCHIVED", 409, {
        latest: latestSource,
        conflictFields: ["subjectId"],
        workbench: planInboxWorkbench,
      });
    }
    if (session.status !== "COMPLETED" || !session.endedAt || session.isLowConversion !== true) {
      throw new ApiError("LOW_CONVERSION_SOURCE_INVALID", 409, {
        latest: latestSource,
        conflictFields: ["status", "endedAt", "isLowConversion"],
        workbench: planInboxWorkbench,
      });
    }
    if (session.closeoutVersion !== input.expectedCloseoutVersion) {
      throw new ApiError("LOW_CONVERSION_SOURCE_STALE", 409, {
        latest: latestSource,
        conflictFields: ["closeoutVersion"],
        workbench: planInboxWorkbench,
      });
    }
    const originKey = `low-conversion:${session.id}`;
    const plannedDate = getStudyDayRange(session.endedAt).start.toISOString();
    return (await createPlanInboxItemWithResult(tx, workspace.id, actorId, {
      stableKey: `${originKey}:v${session.closeoutVersion}`,
      originKey,
      originVersion: session.closeoutVersion,
      originType: "LOW_CONVERSION",
      originSnapshot: {
        provenanceVersion: 1,
        source: "LOW_CONVERSION",
        sessionId: session.id,
        closeoutVersion: session.closeoutVersion,
        taskId: session.taskId,
        endedAt: session.endedAt.toISOString(),
      },
      title: session.requiredOutput?.trim() || `补充产出：${session.task?.title ?? session.subject.name}`,
      subjectId: session.subjectId,
      plannedDate,
      estimatedMinutes: 15,
      priority: "HIGH",
      type: "focus",
      primaryNodeId: session.syllabusNodeId,
    })).item;
  });
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
  const activeWorkspace = await lockActiveWorkspaceForWrite(tx, actorId);
  if (activeWorkspace.id !== workspaceId) {
    throw new ApiError("ACTIVE_WORKSPACE_CHANGED", 409, {
      latest: {
        kind: "plan-inbox-workspace",
        workspace: {
          id: activeWorkspace.id,
          revision: activeWorkspace.revision,
          status: activeWorkspace.status,
        },
      },
      conflictFields: ["workspaceId"],
    });
  }
  const origin = buildOriginIdentity({ originKey: input.originKey, originVersion: input.originVersion });
  const existing = await tx.planInboxItem.findFirst({
    where: { workspaceId, originKey: origin.originKey, originVersion: origin.originVersion },
    include: { dependencyRefs: true },
  });
  if (existing) {
    if (!matchesImmutableInboxOrigin(existing, input)) {
      throw new ApiError("PLAN_INBOX_ORIGIN_CONFLICT", 409, {
        latest: serialize(existing),
        conflictFields: ["originKey", "originVersion", "originSnapshot"],
      });
    }
    return { item: serialize(existing), created: false, reused: true, superseded: [] };
  }

  const newer = await tx.planInboxItem.findFirst({
    where: { workspaceId, originKey: origin.originKey, originVersion: { gt: origin.originVersion } },
    include: { dependencyRefs: true },
    orderBy: { originVersion: "desc" },
  });
  if (newer) {
    throw new ApiError("PLAN_INBOX_ORIGIN_VERSION_STALE", 409, {
      latest: serialize(newer),
      conflictFields: ["originVersion"],
    });
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
    const changed = await tx.planInboxItem.updateMany({
      where: {
        id: { in: previous.map((item) => item.id) },
        status: "OPEN",
        supersededByItemId: null,
      },
      data: { supersededByItemId: created.id, revision: { increment: 1 } },
    });
    if (changed.count !== previous.length) {
      const latest = await tx.planInboxItem.findFirst({
        where: { workspaceId, originKey: origin.originKey, id: { not: created.id } },
        include: { dependencyRefs: true },
        orderBy: { originVersion: "desc" },
      });
      throw new ApiError("PLAN_INBOX_SUPERSEDE_CONFLICT", 409, {
        latest: latest ? serialize(latest) : { kind: "plan-inbox-origin", item: null },
        conflictFields: ["originVersion", "supersededByItemId"],
      });
    }
  }
  const superseded = previous.map((item) => serialize({ ...item, supersededByItemId: created.id, revision: item.revision + 1 }));
  await tx.auditEvent.create({
    data: {
      actorId,
      action: "PLAN_INBOX_CREATED",
      entityType: "PlanInboxItem",
      entityId: created.id,
      metadata: {
        originKey: origin.originKey,
        originVersion: origin.originVersion,
        supersededCount: superseded.length,
      },
    },
  });
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
  return withPlanInboxConflictContext(actorId, itemId, () => prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
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
  }));
}

export async function dismissPlanInboxItem(
  actorId: string,
  itemId: string,
  expectedRevision: number,
): Promise<PlanInboxItemDto> {
  return withPlanInboxConflictContext(actorId, itemId, () => prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
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
  }));
}

export async function reopenPlanInboxItem(
  actorId: string,
  itemId: string,
  expectedRevision: number,
): Promise<PlanInboxItemDto> {
  return withPlanInboxConflictContext(actorId, itemId, () => prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
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
  }));
}

export async function convertPlanInboxItem(
  actorId: string,
  itemId: string,
  input: {
    expectedRevision: number;
    idempotencyKey: string;
  },
): Promise<PlanInboxItemDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = planInboxConvertFingerprint(itemId, input.expectedRevision);

  return withPlanInboxConflictContext(actorId, itemId, () => prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command: PersistentCreateCommand = {
      actorId,
      workspaceId: workspace.id,
      action: "PLAN_INBOX_CONVERTED",
      entityType: "PlanInboxItem",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "PLAN_INBOX_IDEMPOTENCY_CONFLICT",
    };
    const claim = await claimPersistentCreateCommand(tx, command);
    if (claim.state === "pending") {
      throw new ApiError("PLAN_INBOX_CONVERSION_IN_PROGRESS", 409, {
        conflictFields: ["idempotencyKey"],
      });
    }
    if (claim.state === "replayed") {
      const replayed = await tx.planInboxItem.findFirst({
        where: { id: claim.replay.resultId, workspaceId: workspace.id },
        include: { dependencyRefs: true },
      });
      if (!replayed || replayed.status !== "CONVERTED" || !replayed.convertedTaskId) {
        throw new ApiError("PLAN_INBOX_CONVERSION_RESULT_UNAVAILABLE", 409, {
          conflictFields: ["idempotencyKey", "convertedTaskId"],
        });
      }
      return serialize(replayed);
    }

    await lockWorkspaceDependencyGraph(tx, workspace.id);
    await lockInboxItem(tx, itemId);
    const existing = await tx.planInboxItem.findFirst({
      where: { id: itemId, workspaceId: workspace.id },
      include: { dependencyRefs: true },
    });
    if (!existing) throw new ApiError("PLAN_INBOX_ITEM_NOT_FOUND", 404);

    if (existing.status === "CONVERTED" && existing.convertedTaskId) {
      throw new ApiError("PLAN_INBOX_ALREADY_CONVERTED", 409, {
        latest: serialize(existing),
        conflictFields: ["status", "convertedTaskId", "idempotencyKey"],
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
    await assertTrustedOriginCurrent(tx, workspace.id, existing);

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

    const reviewScheduleId = await resolveTrustedInboxReviewScheduleId(
      tx,
      workspace.id,
      existing,
      subjectId,
    );

    const normalizedPriority = existing.priority?.toUpperCase();
    const priority = normalizedPriority === "LOW" || normalizedPriority === "MEDIUM" || normalizedPriority === "HIGH" || normalizedPriority === "CRITICAL"
      ? normalizedPriority
      : "MEDIUM";

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

    await completePersistentCreateClaim(
      tx,
      command,
      claim.claimEventId,
      existing.id,
      {
        taskId: task.id,
        reviewScheduleId,
        dependencyCount: resolvedDependencies.length,
      },
      serialize(updated) as unknown as Prisma.InputJsonValue,
    );

    await refreshWorkspaceCheckInSnapshotForDate(workspace.id, plannedDate, tx);

    return serialize(updated);
  }));
}

export interface PlanInboxFormOptions {
  subjects: Array<{ id: string; name: string }>;
  nodes: Array<{ id: string; subjectId: string; title: string }>;
  milestones: Array<{ id: string; subjectId: string | null; title: string }>;
  tasks: Array<{ id: string; subjectId: string; subjectName: string; title: string }>;
  stagePlans: Array<{ id: string; name: string }>;
}

export async function getPlanInboxFormOptions(actorId: string): Promise<PlanInboxFormOptions> {
  const workspace = await resolveActiveWorkspace(actorId);
  const [subjects, nodes, milestones, tasks, stagePlans] = await Promise.all([
    prisma.subject.findMany({ where: { workspaceId: workspace.id, archivedAt: null }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
    prisma.syllabusNode.findMany({ where: { subject: { workspaceId: workspace.id }, archivedAt: null }, select: { id: true, subjectId: true, title: true }, orderBy: { title: "asc" } }),
    prisma.planMilestone.findMany({ where: { workspaceId: workspace.id, archivedAt: null }, select: { id: true, subjectId: true, title: true }, orderBy: { sortOrder: "asc" } }),
    prisma.studyTask.findMany({
      where: { subject: { workspaceId: workspace.id, archivedAt: null }, status: { notIn: ["DONE", "SKIPPED"] } },
      select: { id: true, subjectId: true, title: true, subject: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.stagePlan.findMany({ where: { workspaceId: workspace.id, status: { in: ["active", "draft"] } }, select: { id: true, name: true }, orderBy: [{ status: "asc" }, { startDate: "asc" }] }),
  ]);
  return {
    subjects,
    nodes,
    milestones,
    tasks: tasks.map(({ subject, ...task }) => ({ ...task, subjectName: subject.name })),
    stagePlans,
  };
}

function planInboxConvertFingerprint(itemId: string, expectedRevision: number): string {
  return buildPersistentCreateFingerprint("plan-inbox-convert-v3", {
    itemId,
    expectedRevision,
    reviewScheduleSource: "trusted-origin-only",
  });
}

async function resolveTrustedInboxReviewScheduleId(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  item: PlanInboxRow,
  subjectId: string,
): Promise<string | null> {
  if (item.originType !== "REVIEW_DUE") return null;
  const snapshot = asRecord(item.originSnapshot);
  const reviewScheduleId = typeof snapshot.reviewScheduleId === "string"
    ? snapshot.reviewScheduleId
    : null;
  const reviewScheduleRevision = typeof snapshot.reviewScheduleRevision === "number"
    && Number.isInteger(snapshot.reviewScheduleRevision)
    && snapshot.reviewScheduleRevision > 0
    ? snapshot.reviewScheduleRevision
    : null;
  const dueDate = typeof snapshot.dueDate === "string" && !Number.isNaN(Date.parse(snapshot.dueDate))
    ? new Date(snapshot.dueDate).toISOString()
    : null;
  if (!reviewScheduleId || reviewScheduleRevision == null || !dueDate) {
    throw new ApiError("PLAN_INBOX_ORIGIN_STALE", 409, {
      conflictFields: ["originSnapshot.reviewScheduleId", "originSnapshot.reviewScheduleRevision", "originSnapshot.dueDate"],
    });
  }
  const schedule = await getBridgableReviewScheduleInTx(
    tx,
    workspaceId,
    reviewScheduleId,
    subjectId,
  );
  if (
    reviewScheduleRevision !== schedule.revision
    || dueDate !== schedule.dueDate?.toISOString()
  ) {
    throw new ApiError("PLAN_INBOX_ORIGIN_STALE", 409, {
      latest: { reviewScheduleId: schedule.id, revision: schedule.revision, dueDate: schedule.dueDate?.toISOString() },
      conflictFields: ["originSnapshot", "reviewScheduleId"],
    });
  }
  return schedule.id;
}

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function withoutSubjectResultRevision(value: Record<string, unknown>): Record<string, unknown> {
  const semanticSnapshot = { ...value };
  delete semanticSnapshot.subjectResultRevision;
  return semanticSnapshot;
}

async function lockInboxItem(tx: Prisma.TransactionClient, itemId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM "PlanInboxItem" WHERE "id" = ${itemId} FOR UPDATE`;
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
  const latest = await loadPlanInboxRelationConflictLatest(tx, workspaceId, input);
  if (input.subjectId && (!latest.relations.subject || latest.relations.subject.archived)) {
    throw new ApiError("PLAN_INBOX_SUBJECT_INVALID", 409, { latest, conflictFields: ["subjectId"] });
  }
  const nodeIds = Array.from(new Set([input.primaryNodeId, ...input.relatedNodeIds].filter((id): id is string => Boolean(id))));
  if (nodeIds.length) {
    if (!input.subjectId) {
      throw new ApiError("PLAN_INBOX_NODE_REQUIRES_SUBJECT", 409, {
        latest,
        conflictFields: ["subjectId", "primaryNodeId", "relatedNodeIds"],
      });
    }
    const validNodeCount = latest.relations.nodes.filter((node) => node.subjectId === input.subjectId && !node.archived).length;
    if (validNodeCount !== nodeIds.length) {
      throw new ApiError("PLAN_INBOX_NODE_INVALID", 409, {
        latest,
        conflictFields: ["primaryNodeId", "relatedNodeIds"],
      });
    }
  }
  if (input.planMilestoneId) {
    const milestone = latest.relations.planMilestone;
    if (!milestone || milestone.archived || (input.subjectId && milestone.subjectId && milestone.subjectId !== input.subjectId)) {
      throw new ApiError("PLAN_INBOX_MILESTONE_INVALID", 409, {
        latest,
        conflictFields: ["planMilestoneId"],
      });
    }
  }
  const predecessorIds = Array.from(new Set(input.predecessorTasks.map((dependency) => dependency.taskId)));
  const validPredecessorCount = latest.relations.predecessorTasks.filter((task) => !task.subjectArchived).length;
  if (validPredecessorCount !== predecessorIds.length) {
    throw new ApiError("PLAN_INBOX_DEPENDENCY_INVALID", 409, {
      latest,
      conflictFields: ["predecessorTasks"],
    });
  }
}

async function loadPlanInboxRelationConflictLatest(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  input: {
    subjectId: string | null;
    planMilestoneId: string | null;
    primaryNodeId: string | null;
    relatedNodeIds: string[];
    predecessorTasks: Array<{ taskId: string; dependencyType: TaskDependencyType }>;
  },
): Promise<PlanInboxRelationConflictLatest> {
  const nodeIds = Array.from(new Set([input.primaryNodeId, ...input.relatedNodeIds].filter((id): id is string => Boolean(id))));
  const predecessorIds = Array.from(new Set(input.predecessorTasks.map((dependency) => dependency.taskId)));
  const [subject, planMilestone, nodes, predecessorTasks] = await Promise.all([
    input.subjectId ? tx.subject.findFirst({
      where: { id: input.subjectId, workspaceId },
      select: { id: true, archivedAt: true },
    }) : null,
    input.planMilestoneId ? tx.planMilestone.findFirst({
      where: { id: input.planMilestoneId, workspaceId },
      select: { id: true, subjectId: true, archivedAt: true },
    }) : null,
    nodeIds.length ? tx.syllabusNode.findMany({
      where: { id: { in: nodeIds }, subject: { workspaceId } },
      select: { id: true, subjectId: true, archivedAt: true },
    }) : [],
    predecessorIds.length ? tx.studyTask.findMany({
      where: { id: { in: predecessorIds }, subject: { workspaceId } },
      select: { id: true, subjectId: true, status: true, subject: { select: { archivedAt: true } } },
    }) : [],
  ]);
  return {
    kind: "plan-inbox-relations",
    item: null,
    relations: {
      subject: subject ? { id: subject.id, archived: Boolean(subject.archivedAt) } : null,
      planMilestone: planMilestone ? {
        id: planMilestone.id,
        subjectId: planMilestone.subjectId,
        archived: Boolean(planMilestone.archivedAt),
      } : null,
      nodes: nodes.map((node) => ({ id: node.id, subjectId: node.subjectId, archived: Boolean(node.archivedAt) })),
      predecessorTasks: predecessorTasks.map((task) => ({
        id: task.id,
        subjectId: task.subjectId,
        status: task.status,
        subjectArchived: Boolean(task.subject.archivedAt),
      })),
    },
  };
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
      const predecessor = ref.importBatchId
        ? await resolveImportedPlanPredecessor(tx, workspaceId, {
            importBatchId: ref.importBatchId,
            sourcePlanStableKey: ref.planStableKey,
            originVersion: ref.planOriginVersion,
          })
        : await tx.planInboxItem.findFirst({
            where: {
              workspaceId,
              stableKey: ref.planStableKey,
              ...(ref.planOriginVersion ? { originVersion: ref.planOriginVersion } : {}),
            },
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
  const unique = Array.from(new Map(resolved.map((dependency) => [dependency.taskId, dependency])).values());
  if (unique.length) {
    const validTasks = await tx.studyTask.count({
      where: {
        id: { in: unique.map((dependency) => dependency.taskId) },
        subject: { workspaceId, archivedAt: null },
      },
    });
    if (validTasks !== unique.length) {
      throw new ApiError("PLAN_INBOX_DEPENDENCY_INVALID", 409, { conflictFields: ["dependencyRefs"] });
    }
  }
  return unique;
}

async function resolveImportedPlanPredecessor(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  input: { importBatchId: string; sourcePlanStableKey: string; originVersion: number | null },
): Promise<PlanInboxRow | null> {
  const mapping = await tx.learningTreeImportItem.findFirst({
    where: {
      batchId: input.importBatchId,
      objectType: "plan",
      sourceTargetKey: input.sourcePlanStableKey,
      batch: { workspaceId },
    },
    select: { mappedTargetId: true },
  });
  if (!mapping?.mappedTargetId) return null;
  return tx.planInboxItem.findFirst({
    where: {
      id: mapping.mappedTargetId,
      workspaceId,
      ...(input.originVersion ? { originVersion: input.originVersion } : {}),
    },
    include: { dependencyRefs: true },
  });
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
  if (item.originType === "LOW_CONVERSION" && typeof snapshot.sessionId === "string") {
    const source = await tx.studySession.findFirst({
      where: { id: snapshot.sessionId, subject: { workspaceId } },
      select: { subject: { select: { archivedAt: true } } },
    });
    return !source || Boolean(source.subject.archivedAt);
  }
  return false;
}

async function assertTrustedOriginCurrent(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  item: PlanInboxRow,
): Promise<void> {
  if (item.originType === "LOW_CONVERSION") {
    await assertLowConversionOriginCurrent(tx, workspaceId, item);
    return;
  }
  if (item.originType !== "SIMULATION_LOSS") return;
  const snapshot = asRecord(item.originSnapshot);
  const examId = typeof snapshot.examId === "string" ? snapshot.examId : null;
  if (!examId) throw simulationOriginStale(item);

  const exam = await tx.simulationExam.findFirst({
    where: { id: examId, workspaceId },
    select: {
      subjectResults: {
        select: {
          id: true,
          subjectId: true,
          revision: true,
          subject: { select: { archivedAt: true } },
          lossItems: {
            where: { archivedAt: null },
            select: { id: true, reason: true, syllabusNodeId: true, lostScore: true },
          },
        },
      },
    },
  });
  if (!exam) throw new ApiError("PLAN_INBOX_ORIGIN_ARCHIVED", 409);

  const itemLookup = new Map(exam.subjectResults.flatMap((result) => (
    result.lossItems.map((lossItem) => [lossItem.id, { lossItem, result }] as const)
  )));
  const groups = buildSimulationRemediationGroups(exam.subjectResults.flatMap((result) => (
    result.lossItems.map((lossItem) => ({
      id: lossItem.id,
      subjectId: result.subjectId,
      reason: lossItem.reason as SimulationLossReason,
      syllabusNodeId: lossItem.syllabusNodeId,
      lostScore: lossItem.lostScore,
    }))
  )), { examId });
  const group = groups.find((candidate) => candidate.originKey === item.originKey);
  const sample = group?.itemIds[0] ? itemLookup.get(group.itemIds[0]) : undefined;
  if (!group || !sample) throw simulationOriginStale(item);
  if (sample.result.subject.archivedAt) {
    throw new ApiError("PLAN_INBOX_ORIGIN_ARCHIVED", 409, {
      conflictFields: ["originSnapshot.subjectId"],
    });
  }

  const currentSnapshot = buildSimulationRemediationOriginSnapshot({
    examId,
    subjectResultId: sample.result.id,
    subjectResultRevision: sample.result.revision,
    subjectId: group.subjectId,
    reason: group.reason,
    syllabusNodeId: group.syllabusNodeId,
    itemIds: group.itemIds,
    lostScore: group.lostScore,
  });
  const storedSemantics = withoutSubjectResultRevision(snapshot);
  const currentSemantics = withoutSubjectResultRevision(currentSnapshot);
  if (stableStringify(storedSemantics) !== stableStringify(currentSemantics)) {
    throw simulationOriginStale(item, sample.result.revision);
  }
  const storedRevision = typeof snapshot.subjectResultRevision === "number"
    && Number.isInteger(snapshot.subjectResultRevision)
    ? snapshot.subjectResultRevision
    : null;
  if (
    storedRevision == null
    || storedRevision > sample.result.revision
    || (storedRevision !== sample.result.revision && !(await isPureSimulationLifecycleRestore(
      tx,
      item,
      sample.result.id,
      storedRevision,
      sample.result.revision,
    )))
  ) {
    throw simulationOriginStale(item, sample.result.revision);
  }
}

async function assertLowConversionOriginCurrent(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  item: PlanInboxRow,
): Promise<void> {
  const snapshot = asRecord(item.originSnapshot);
  const sessionId = typeof snapshot.sessionId === "string" ? snapshot.sessionId : null;
  const closeoutVersion = typeof snapshot.closeoutVersion === "number" && Number.isInteger(snapshot.closeoutVersion)
    ? snapshot.closeoutVersion
    : null;
  if (!sessionId || closeoutVersion == null) throw new ApiError("PLAN_INBOX_ORIGIN_STALE", 409);
  const session = await tx.studySession.findFirst({
    where: { id: sessionId, subject: { workspaceId } },
    select: {
      status: true,
      endedAt: true,
      isLowConversion: true,
      closeoutVersion: true,
      subject: { select: { archivedAt: true } },
    },
  });
  if (!session || session.subject.archivedAt) throw new ApiError("PLAN_INBOX_ORIGIN_ARCHIVED", 409);
  if (
    session.status !== "COMPLETED"
    || !session.endedAt
    || session.isLowConversion !== true
    || session.closeoutVersion !== closeoutVersion
  ) {
    throw new ApiError("PLAN_INBOX_ORIGIN_STALE", 409, {
      latest: { closeoutVersion: session.closeoutVersion },
      conflictFields: ["originSnapshot.closeoutVersion"],
    });
  }
}

async function isPureSimulationLifecycleRestore(
  tx: Prisma.TransactionClient,
  item: PlanInboxRow,
  subjectResultId: string,
  storedRevision: number,
  currentRevision: number,
): Promise<boolean> {
  const revisionDelta = currentRevision - storedRevision;
  if (revisionDelta <= 0) return revisionDelta === 0;
  const events = await tx.auditEvent.findMany({
    where: {
      entityType: "SimulationLossItem",
      entityId: { not: null },
      createdAt: { gt: item.createdAt },
      action: {
        in: [
          "SIMULATION_LOSS_ITEM_CREATED",
          "SIMULATION_LOSS_ITEM_UPDATED",
          "SIMULATION_LOSS_ITEM_ARCHIVED",
          "SIMULATION_LOSS_ITEM_RESTORED",
        ],
      },
    },
    select: { action: true, entityId: true },
  });
  const eventEntityIds = events.flatMap((event) => event.entityId ? [event.entityId] : []);
  if (eventEntityIds.length === 0) return false;
  const sourceItems = await tx.simulationLossItem.findMany({
    where: { id: { in: eventEntityIds }, simulationSubjectResultId: subjectResultId },
    select: { id: true },
  });
  const sourceItemIds = new Set(sourceItems.map((source) => source.id));
  const sourceEvents = events.filter((event) => event.entityId && sourceItemIds.has(event.entityId));
  return sourceEvents.length === revisionDelta && sourceEvents.every((event) => (
    event.action === "SIMULATION_LOSS_ITEM_ARCHIVED" || event.action === "SIMULATION_LOSS_ITEM_RESTORED"
  ));
}

function simulationOriginStale(item: PlanInboxRow, currentVersion?: number): ApiError {
  return new ApiError("PLAN_INBOX_ORIGIN_STALE", 409, {
    latest: currentVersion == null ? undefined : { originKey: item.originKey, originVersion: currentVersion },
    conflictFields: ["originKey", "originVersion", "originSnapshot"],
  });
}
