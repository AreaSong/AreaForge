import { assertExpectedRevision } from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { resolveActiveWorkspace } from "./exam-workspace-service";

export interface PlanMilestoneDto {
  id: string;
  workspaceId: string;
  stagePlanId: string;
  subjectId: string | null;
  stableKey: string;
  title: string;
  targetDate: string | null;
  sortOrder: number;
  status: string;
  revision: number;
  archivedAt: string | null;
}

function serialize(row: {
  id: string;
  workspaceId: string;
  stagePlanId: string;
  subjectId: string | null;
  stableKey: string;
  title: string;
  targetDate: Date | null;
  sortOrder: number;
  status: string;
  revision: number;
  archivedAt: Date | null;
}): PlanMilestoneDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    stagePlanId: row.stagePlanId,
    subjectId: row.subjectId,
    stableKey: row.stableKey,
    title: row.title,
    targetDate: row.targetDate?.toISOString() ?? null,
    sortOrder: row.sortOrder,
    status: row.status,
    revision: row.revision,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export async function listPlanMilestones(actorId: string): Promise<PlanMilestoneDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const rows = await prisma.planMilestone.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(serialize);
}

export async function createPlanMilestone(
  actorId: string,
  input: {
    stagePlanId: string;
    stableKey: string;
    title: string;
    subjectId?: string | null;
    targetDate?: string | null;
    sortOrder?: number;
  },
): Promise<PlanMilestoneDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const stagePlan = await prisma.stagePlan.findFirst({
    where: {
      id: input.stagePlanId,
      OR: [{ workspaceId: workspace.id }, { workspaceId: null }],
    },
  });
  if (!stagePlan) throw new ApiError("STAGE_PLAN_NOT_FOUND", 404);

  if (input.subjectId) {
    const subject = await prisma.subject.findFirst({
      where: { id: input.subjectId, OR: [{ workspaceId: workspace.id }, { workspaceId: null }] },
    });
    if (!subject) throw new ApiError("SUBJECT_NOT_FOUND", 404);
  }

  const created = await prisma.planMilestone.create({
    data: {
      workspaceId: workspace.id,
      stagePlanId: input.stagePlanId,
      subjectId: input.subjectId ?? null,
      stableKey: input.stableKey.trim(),
      title: input.title.trim(),
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
      sortOrder: input.sortOrder ?? 0,
    },
  });

  await prisma.auditEvent.create({
    data: {
      actorId,
      action: "PLAN_MILESTONE_CREATED",
      entityType: "PlanMilestone",
      entityId: created.id,
    },
  });

  return serialize(created);
}

export async function updatePlanMilestone(
  actorId: string,
  milestoneId: string,
  input: {
    expectedRevision: number;
    title?: string;
    targetDate?: string | null;
    sortOrder?: number;
    status?: string;
    archive?: boolean;
  },
): Promise<PlanMilestoneDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const existing = await prisma.planMilestone.findFirst({
    where: { id: milestoneId, workspaceId: workspace.id },
  });
  if (!existing) throw new ApiError("PLAN_MILESTONE_NOT_FOUND", 404);

  if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) === "revision_conflict") {
    throw new ApiError("PLAN_MILESTONE_REVISION_CONFLICT", 409, {
      latest: serialize(existing),
      conflictFields: ["revision"],
    });
  }

  const updated = await prisma.planMilestone.update({
    where: { id: existing.id },
    data: {
      title: input.title?.trim() ?? undefined,
      targetDate: input.targetDate === undefined ? undefined : input.targetDate ? new Date(input.targetDate) : null,
      sortOrder: input.sortOrder,
      status: input.status,
      archivedAt: input.archive === true ? new Date() : input.archive === false ? null : undefined,
      revision: { increment: 1 },
    },
  });

  return serialize(updated);
}
