import { assertExpectedRevision } from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import type { StagePlanDto } from "./types";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
} from "./persistent-idempotency";

const milestoneWorkbench = "/plan/stages";

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

export interface PlanMilestoneConflictLatest {
  kind: "plan-milestone";
  milestone: PlanMilestoneDto | null;
  stagePlan?: StagePlanDto | null;
  commandState?: "conflict" | "result_unavailable";
  sourceConflict?: unknown;
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
    idempotencyKey: string;
    stagePlanId: string;
    expectedStagePlanRevision?: number;
    stableKey: string;
    title: string;
    subjectId?: string | null;
    targetDate?: string | null;
    sortOrder?: number;
  },
): Promise<PlanMilestoneDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const stableKey = input.stableKey.trim();
  const title = input.title.trim();
  const requestFingerprint = buildPersistentCreateFingerprint("plan-milestone-create-v1", {
    stagePlanId: input.stagePlanId,
    expectedStagePlanRevision: input.expectedStagePlanRevision ?? null,
    stableKey,
    title,
    subjectId: input.subjectId ?? null,
    targetDate: input.targetDate ?? null,
    sortOrder: input.sortOrder ?? 0,
  });
  try {
    return await prisma.$transaction(async (tx) => {
      const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
      const command = {
        actorId,
        workspaceId: workspace.id,
        action: "PLAN_MILESTONE_CREATED",
        entityType: "PlanMilestone",
        idempotencyKey,
        requestFingerprint,
        conflictCode: "PLAN_MILESTONE_IDEMPOTENCY_CONFLICT",
      };
      const replay = await findPersistentCreateReplay(tx, command);
      if (replay) {
        const snapshot = parseMilestoneSnapshot(replay.resultSnapshot);
        if (snapshot) return snapshot;
        const stored = await tx.planMilestone.findFirst({ where: { id: replay.resultId, workspaceId: workspace.id } });
        if (!stored) throw new ApiError("PLAN_MILESTONE_IDEMPOTENCY_RESULT_UNAVAILABLE", 409);
        return serialize(stored);
      }

      const stagePlan = await tx.stagePlan.findFirst({
        where: { id: input.stagePlanId, workspaceId: workspace.id },
      });
      if (!stagePlan) throw new ApiError("STAGE_PLAN_NOT_FOUND", 404);
      if (input.expectedStagePlanRevision !== undefined && stagePlan.revision !== input.expectedStagePlanRevision) {
        throw new ApiError("PLAN_MILESTONE_STAGE_PLAN_REVISION_CONFLICT", 409, {
          latest: milestoneConflictLatest(null, undefined, undefined, serializeStagePlan(stagePlan)),
          conflictFields: ["stagePlan.revision"],
          workbench: milestoneWorkbench,
        });
      }

      if (input.subjectId) {
        const subject = await tx.subject.findFirst({
          where: { id: input.subjectId, workspaceId: workspace.id, archivedAt: null },
        });
        if (!subject) throw new ApiError("SUBJECT_NOT_FOUND", 404);
      }

      const duplicate = await tx.planMilestone.findFirst({ where: { workspaceId: workspace.id, stableKey } });
      if (duplicate) {
        throw new ApiError("PLAN_MILESTONE_STABLE_KEY_CONFLICT", 409, {
          latest: milestoneConflictLatest(serialize(duplicate), undefined, undefined, serializeStagePlan(stagePlan)),
          conflictFields: ["stableKey"],
          workbench: milestoneWorkbench,
        });
      }

      const created = await tx.planMilestone.create({
        data: {
          workspaceId: workspace.id,
          stagePlanId: input.stagePlanId,
          subjectId: input.subjectId ?? null,
          stableKey,
          title,
          targetDate: input.targetDate ? new Date(input.targetDate) : null,
          sortOrder: input.sortOrder ?? 0,
        },
      });

      const result = serialize(created);
      await recordPersistentCreateResult(tx, command, created.id, {
        stagePlanId: created.stagePlanId,
        stableKey: created.stableKey,
        resultSnapshot: result as unknown as Prisma.InputJsonObject,
      });
      return result;
    });
  } catch (error) {
    if (!(error instanceof ApiError) && !isUniqueViolation(error)) throw error;
    const workspace = await resolveActiveWorkspace(actorId);
    const [latest, stagePlan] = await Promise.all([
      prisma.planMilestone.findFirst({ where: { workspaceId: workspace.id, stableKey } }),
      prisma.stagePlan.findFirst({ where: { id: input.stagePlanId, workspaceId: workspace.id } }),
    ]);
    if (isUniqueViolation(error)) {
      throw new ApiError("PLAN_MILESTONE_STABLE_KEY_CONFLICT", 409, {
        latest: milestoneConflictLatest(
          latest ? serialize(latest) : null,
          undefined,
          undefined,
          stagePlan ? serializeStagePlan(stagePlan) : null,
        ),
        conflictFields: ["stableKey"],
        workbench: milestoneWorkbench,
      });
    }
    if (!(error instanceof ApiError)) throw error;
    if (error.status !== 409) throw error;
    throw new ApiError(error.code, 409, {
      latest: isMilestoneConflictLatest(error.details?.latest)
        ? error.details.latest
        : milestoneConflictLatest(
            latest ? serialize(latest) : null,
            error.code.includes("RESULT_UNAVAILABLE") ? "result_unavailable" : "conflict",
            error.details?.latest,
            stagePlan ? serializeStagePlan(stagePlan) : null,
          ),
      conflictFields: error.details?.conflictFields?.length ? error.details.conflictFields : ["idempotencyKey"],
      workbench: milestoneWorkbench,
    });
  }
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
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await tx.planMilestone.findFirst({
      where: { id: milestoneId, workspaceId: workspace.id },
    });
    if (!existing) throw new ApiError("PLAN_MILESTONE_NOT_FOUND", 404);

    if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) === "revision_conflict") {
      throw new ApiError("PLAN_MILESTONE_REVISION_CONFLICT", 409, {
        latest: milestoneConflictLatest(serialize(existing)),
        conflictFields: ["revision"],
        workbench: milestoneWorkbench,
      });
    }

    const changed = await tx.planMilestone.updateMany({
      where: { id: existing.id, workspaceId: workspace.id, revision: input.expectedRevision },
      data: {
        title: input.title?.trim() ?? undefined,
        targetDate: input.targetDate === undefined ? undefined : input.targetDate ? new Date(input.targetDate) : null,
        sortOrder: input.sortOrder,
        status: input.status,
        archivedAt: input.archive === true ? new Date() : input.archive === false ? null : undefined,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      const latest = await tx.planMilestone.findUnique({ where: { id: existing.id } });
      throw new ApiError("PLAN_MILESTONE_REVISION_CONFLICT", 409, {
        latest: milestoneConflictLatest(latest ? serialize(latest) : null),
        conflictFields: ["revision"],
        workbench: milestoneWorkbench,
      });
    }
    const updated = await tx.planMilestone.findUniqueOrThrow({ where: { id: existing.id } });
    await tx.auditEvent.create({
      data: { actorId, action: "PLAN_MILESTONE_UPDATED", entityType: "PlanMilestone", entityId: existing.id },
    });

    return serialize(updated);
  });
}

function parseMilestoneSnapshot(value: Prisma.JsonValue | undefined): PlanMilestoneDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.id === "string" && typeof value.revision === "number"
    ? value as unknown as PlanMilestoneDto
    : null;
}

function milestoneConflictLatest(
  milestone: PlanMilestoneDto | null,
  commandState?: PlanMilestoneConflictLatest["commandState"],
  sourceConflict?: unknown,
  stagePlan?: StagePlanDto | null,
): PlanMilestoneConflictLatest {
  return {
    kind: "plan-milestone",
    milestone,
    ...(stagePlan === undefined ? {} : { stagePlan }),
    ...(commandState ? { commandState } : {}),
    ...(sourceConflict === undefined ? {} : { sourceConflict }),
  };
}

function serializeStagePlan(row: {
  id: string;
  revision: number;
  name: string;
  startDate: Date;
  endDate: Date;
  goal: string;
  mode: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): StagePlanDto {
  return {
    id: row.id,
    revision: row.revision,
    name: row.name,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    goal: row.goal,
    mode: row.mode as StagePlanDto["mode"],
    status: row.status as StagePlanDto["status"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isMilestoneConflictLatest(value: unknown): value is PlanMilestoneConflictLatest {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === "plan-milestone");
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002");
}
