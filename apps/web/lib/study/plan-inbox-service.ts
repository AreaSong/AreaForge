import {
  assertExpectedRevision,
  buildOriginIdentity,
  canConvertInboxItem,
  canDismissInboxItem,
  canReopenInboxItem,
  type PlanInboxItemStatus,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import { getStudyDayRange } from "./date";

export interface PlanInboxItemDto {
  id: string;
  workspaceId: string;
  stableKey: string;
  originKey: string;
  originVersion: number;
  originType: string;
  status: PlanInboxItemStatus;
  title: string;
  subjectId: string | null;
  plannedDate: string | null;
  estimatedMinutes: number | null;
  priority: string | null;
  type: string | null;
  planMilestoneId: string | null;
  primaryNodeId: string | null;
  revision: number;
  convertedTaskId: string | null;
  supersededByItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

function serialize(row: {
  id: string;
  workspaceId: string;
  stableKey: string;
  originKey: string;
  originVersion: number;
  originType: string;
  status: PlanInboxItemStatus;
  title: string;
  subjectId: string | null;
  plannedDate: Date | null;
  estimatedMinutes: number | null;
  priority: string | null;
  type: string | null;
  planMilestoneId: string | null;
  primaryNodeId: string | null;
  revision: number;
  convertedTaskId: string | null;
  supersededByItemId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PlanInboxItemDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    stableKey: row.stableKey,
    originKey: row.originKey,
    originVersion: row.originVersion,
    originType: row.originType,
    status: row.status,
    title: row.title,
    subjectId: row.subjectId,
    plannedDate: row.plannedDate?.toISOString() ?? null,
    estimatedMinutes: row.estimatedMinutes,
    priority: row.priority,
    type: row.type,
    planMilestoneId: row.planMilestoneId,
    primaryNodeId: row.primaryNodeId,
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
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map(serialize);
}

export async function createPlanInboxItem(
  actorId: string,
  input: {
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
  },
): Promise<PlanInboxItemDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const origin = buildOriginIdentity({
    originKey: input.originKey,
    originVersion: input.originVersion,
  });

  try {
    const created = await prisma.planInboxItem.create({
      data: {
        workspaceId: workspace.id,
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
        actorId,
      },
    });
    return serialize(created);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.planInboxItem.findFirst({
        where: {
          workspaceId: workspace.id,
          originKey: origin.originKey,
          originVersion: origin.originVersion,
        },
      });
      if (existing) {
        throw new ApiError("PLAN_INBOX_ORIGIN_CONFLICT", 409, {
          latest: serialize(existing),
          conflictFields: ["originKey", "originVersion"],
        });
      }
    }
    throw error;
  }
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
  },
): Promise<PlanInboxItemDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const existing = await prisma.planInboxItem.findFirst({
    where: { id: itemId, workspaceId: workspace.id },
  });
  if (!existing) throw new ApiError("PLAN_INBOX_ITEM_NOT_FOUND", 404);
  if (existing.supersededByItemId) throw new ApiError("PLAN_INBOX_SUPERSEDED", 409);
  if (existing.status === "CONVERTED") throw new ApiError("PLAN_INBOX_ALREADY_CONVERTED", 409);

  if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) === "revision_conflict") {
    throw new ApiError("PLAN_INBOX_REVISION_CONFLICT", 409, {
      latest: serialize(existing),
      conflictFields: ["revision"],
    });
  }

  const updated = await prisma.planInboxItem.update({
    where: { id: existing.id },
    data: {
      title: input.title?.trim(),
      plannedDate: input.plannedDate === undefined ? undefined : input.plannedDate ? new Date(input.plannedDate) : null,
      estimatedMinutes: input.estimatedMinutes,
      priority: input.priority,
      type: input.type,
      planMilestoneId: input.planMilestoneId,
      primaryNodeId: input.primaryNodeId,
      revision: { increment: 1 },
    },
  });
  return serialize(updated);
}

export async function dismissPlanInboxItem(
  actorId: string,
  itemId: string,
  expectedRevision: number,
): Promise<PlanInboxItemDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const existing = await prisma.planInboxItem.findFirst({
    where: { id: itemId, workspaceId: workspace.id },
  });
  if (!existing) throw new ApiError("PLAN_INBOX_ITEM_NOT_FOUND", 404);
  if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision }) === "revision_conflict") {
    throw new ApiError("PLAN_INBOX_REVISION_CONFLICT", 409, {
      latest: serialize(existing),
      conflictFields: ["revision"],
    });
  }

  const gate = canDismissInboxItem({
    status: existing.status,
    supersededByItemId: existing.supersededByItemId,
  });
  if (gate !== "ok") throw new ApiError(`PLAN_INBOX_${gate.toUpperCase()}`, 409);

  const updated = await prisma.planInboxItem.update({
    where: { id: existing.id },
    data: {
      status: "DISMISSED",
      dismissedAt: new Date(),
      revision: { increment: 1 },
    },
  });
  return serialize(updated);
}

export async function reopenPlanInboxItem(
  actorId: string,
  itemId: string,
  expectedRevision: number,
): Promise<PlanInboxItemDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const existing = await prisma.planInboxItem.findFirst({
    where: { id: itemId, workspaceId: workspace.id },
  });
  if (!existing) throw new ApiError("PLAN_INBOX_ITEM_NOT_FOUND", 404);
  if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision }) === "revision_conflict") {
    throw new ApiError("PLAN_INBOX_REVISION_CONFLICT", 409, {
      latest: serialize(existing),
      conflictFields: ["revision"],
    });
  }

  const gate = canReopenInboxItem({
    status: existing.status,
    supersededByItemId: existing.supersededByItemId,
  });
  if (gate !== "ok") throw new ApiError(`PLAN_INBOX_${gate.toUpperCase()}`, 409);

  const updated = await prisma.planInboxItem.update({
    where: { id: existing.id },
    data: {
      status: "OPEN",
      dismissedAt: null,
      revision: { increment: 1 },
    },
  });
  return serialize(updated);
}

export async function convertPlanInboxItem(
  actorId: string,
  itemId: string,
  input: {
    expectedRevision: number;
    reviewScheduleId?: string | null;
  },
): Promise<PlanInboxItemDto> {
  const workspace = await resolveActiveWorkspace(actorId);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.planInboxItem.findFirst({
      where: { id: itemId, workspaceId: workspace.id },
    });
    if (!existing) throw new ApiError("PLAN_INBOX_ITEM_NOT_FOUND", 404);
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

    const gate = canConvertInboxItem({
      status: existing.status,
      supersededByItemId: existing.supersededByItemId,
      originArchived: false,
    });
    if (gate !== "ok") throw new ApiError(`PLAN_INBOX_${gate.toUpperCase()}`, 409);

    if (!existing.subjectId) {
      throw new ApiError("PLAN_INBOX_SUBJECT_REQUIRED", 400);
    }
    if (!existing.title.trim()) {
      throw new ApiError("PLAN_INBOX_TITLE_REQUIRED", 400);
    }

    const plannedDate = existing.plannedDate ?? getStudyDayRange().start;
    const reviewScheduleId: string | null = input.reviewScheduleId ?? null;
    if (reviewScheduleId) {
      const schedule = await tx.reviewSchedule.findFirst({
        where: { id: reviewScheduleId, workspaceId: workspace.id },
      });
      if (!schedule) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
    }

    const priority =
      existing.priority === "LOW" ||
      existing.priority === "MEDIUM" ||
      existing.priority === "HIGH" ||
      existing.priority === "CRITICAL"
        ? existing.priority
        : "MEDIUM";

    const task = await tx.studyTask.create({
      data: {
        subjectId: existing.subjectId,
        syllabusNodeId: existing.primaryNodeId,
        planMilestoneId: existing.planMilestoneId,
        title: existing.title.trim(),
        type: existing.type?.trim() || "focus",
        priority,
        plannedDate,
        estimatedMinutes: existing.estimatedMinutes ?? 25,
        reviewScheduleId,
      },
    });

    const updated = await tx.planInboxItem.update({
      where: { id: existing.id },
      data: {
        status: "CONVERTED",
        convertedTaskId: task.id,
        convertedAt: new Date(),
        revision: { increment: 1 },
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "PLAN_INBOX_CONVERTED",
        entityType: "PlanInboxItem",
        entityId: existing.id,
        metadata: { taskId: task.id, reviewScheduleId },
      },
    });

    return serialize(updated);
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
