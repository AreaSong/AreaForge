import { createHash } from "node:crypto";
import {
  nextCoachSuggestionStatus,
  stableStringify,
  type CoachSuggestionAction,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { requireRbacFeature } from "@/lib/auth/feature-gates";
import { ApiError } from "@/lib/api/responses";
import type { CurrentUser } from "@/lib/auth/session";
import { requireSharedResourceAccess, requireWorkspacePolicy, type ShareableResourceType } from "@/lib/workspace/policy-service";

export interface CoachSuggestionPayload {
  title: string;
  plannedDate: string | null;
  estimatedMinutes: number | null;
  priority: string | null;
  type: string | null;
  subjectId: string | null;
  primaryNodeId: string | null;
}

export interface CoachSuggestionDto {
  id: string;
  workspaceId: string;
  authorUserId: string;
  recipientUserId: string;
  sourceGrantId: string;
  sourceResourceType: ShareableResourceType;
  sourceResourceId: string;
  sourceSnapshotHash: string;
  payload: CoachSuggestionPayload;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "REVOKED";
  revision: number;
  decidedAt: string | null;
  planInboxItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCoachSuggestionInput {
  workspaceId: string;
  resourceType: ShareableResourceType;
  resourceId: string;
  payload: CoachSuggestionPayload;
}

export async function createCoachSuggestion(
  actor: CurrentUser,
  input: CreateCoachSuggestionInput,
): Promise<CoachSuggestionDto> {
  requireRbacFeature();
  const payload = normalizePayload(input.payload);
  return prisma.$transaction(async (tx) => {
    await requireWorkspacePolicy(tx, actor.id, input.workspaceId, "coach:suggest");
    const access = await requireSharedResourceAccess(tx, {
      actorId: actor.id,
      workspaceId: input.workspaceId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      access: "COACH",
    });
    if (!access.grantId || access.resource.ownerUserId === actor.id) throw suggestionNotFound();
    await assertPayloadSubject(tx, input.workspaceId, payload.subjectId);
    await assertPayloadNode(tx, input.workspaceId, payload.subjectId, payload.primaryNodeId);
    const sourceSnapshotHash = createSourceSnapshotHash(access.resource);
    const suggestion = await tx.coachSuggestion.create({
      data: {
        workspaceId: input.workspaceId,
        authorUserId: actor.id,
        recipientUserId: access.resource.ownerUserId,
        sourceGrantId: access.grantId,
        sourceResourceType: input.resourceType,
        sourceResourceId: input.resourceId,
        sourceSnapshotHash,
        payload: payload as unknown as Prisma.InputJsonObject,
      },
    });
    await writeAudit(tx, actor.id, "COACH_SUGGESTION_CREATED", suggestion.id, {
      workspaceId: input.workspaceId,
      sourceGrantId: access.grantId,
      sourceResourceType: input.resourceType,
      sourceResourceId: input.resourceId,
    });
    return serializeSuggestion(suggestion);
  }, { isolationLevel: "Serializable" });
}

export async function listCoachSuggestions(
  actorId: string,
  workspaceId?: string,
): Promise<CoachSuggestionDto[]> {
  requireRbacFeature();
  const rows = await prisma.coachSuggestion.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      OR: [{ authorUserId: actorId }, { recipientUserId: actorId }],
      workspace: { status: "ACTIVE", memberships: { some: { userId: actorId, status: "ACTIVE" } } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(serializeSuggestion);
}

export async function decideCoachSuggestion(
  actorId: string,
  suggestionId: string,
  action: CoachSuggestionAction,
  expectedRevision: number,
): Promise<CoachSuggestionDto> {
  requireRbacFeature();
  return prisma.$transaction(async (tx) => {
    await lockSuggestion(tx, suggestionId);
    const suggestion = await tx.coachSuggestion.findUnique({ where: { id: suggestionId } });
    if (!suggestion) throw suggestionNotFound();
    await requireWorkspacePolicy(tx, actorId, suggestion.workspaceId, "workspace:read");
    if (suggestion.revision !== expectedRevision) throw new ApiError("COACH_SUGGESTION_CONFLICT", 409);
    if (action === "revoke" && suggestion.authorUserId !== actorId) throw suggestionNotFound();
    if (action !== "revoke" && suggestion.recipientUserId !== actorId) throw suggestionNotFound();
    const nextStatus = nextCoachSuggestionStatus(suggestion.status, action);
    let planInboxItemId: string | null = null;
    if (action === "accept") {
      const source = await requireSharedResourceAccess(tx, {
        actorId: suggestion.authorUserId,
        workspaceId: suggestion.workspaceId,
        resourceType: suggestion.sourceResourceType as ShareableResourceType,
        resourceId: suggestion.sourceResourceId,
        access: "COACH",
      });
      if (
        source.grantId !== suggestion.sourceGrantId
        || source.resource.ownerUserId !== suggestion.recipientUserId
        || createSourceSnapshotHash(source.resource) !== suggestion.sourceSnapshotHash
      ) {
        throw new ApiError("COACH_SUGGESTION_SOURCE_STALE", 409);
      }
      planInboxItemId = await createPlanInboxLineage(tx, suggestion);
    }
    const changed = await tx.coachSuggestion.updateMany({
      where: { id: suggestion.id, status: suggestion.status, revision: expectedRevision },
      data: {
        status: nextStatus,
        decidedAt: new Date(),
        planInboxItemId,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new ApiError("COACH_SUGGESTION_CONFLICT", 409);
    const updated = await tx.coachSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
    await writeAudit(tx, actorId, `COACH_SUGGESTION_${nextStatus}`, suggestion.id, {
      workspaceId: suggestion.workspaceId,
      planInboxItemId,
      sourceGrantId: suggestion.sourceGrantId,
    });
    return serializeSuggestion(updated);
  }, { isolationLevel: "Serializable" });
}

async function createPlanInboxLineage(
  tx: Prisma.TransactionClient,
  suggestion: Prisma.CoachSuggestionGetPayload<object>,
): Promise<string> {
  const payload = parsePayload(suggestion.payload);
  const subject = payload.subjectId
    ? await tx.subject.findFirst({ where: { id: payload.subjectId, workspaceId: suggestion.workspaceId, archivedAt: null }, select: { id: true } })
    : null;
  const primaryNode = payload.primaryNodeId
    ? await tx.syllabusNode.findFirst({
        where: { id: payload.primaryNodeId, archivedAt: null, subject: { workspaceId: suggestion.workspaceId, archivedAt: null, ...(payload.subjectId ? { id: payload.subjectId } : {}) } },
        select: { id: true },
      })
    : null;
  if (payload.subjectId && !subject) throw new ApiError("COACH_SUGGESTION_SOURCE_STALE", 409);
  if (payload.primaryNodeId && !primaryNode) throw new ApiError("COACH_SUGGESTION_SOURCE_STALE", 409);
  const stableKey = `coach-suggestion:${suggestion.id}`;
  const existing = await tx.planInboxItem.findUnique({
    where: {
      workspaceId_ownerUserId_stableKey: {
        workspaceId: suggestion.workspaceId,
        ownerUserId: suggestion.recipientUserId,
        stableKey,
      },
    },
  });
  if (existing) return existing.id;
  const item = await tx.planInboxItem.create({
    data: {
      workspaceId: suggestion.workspaceId,
      ownerUserId: suggestion.recipientUserId,
      stableKey,
      originKey: stableKey,
      originVersion: suggestion.revision,
      originType: "COACH_SUGGESTION",
      originSnapshot: {
        provenanceVersion: 1,
        source: "COACH_SUGGESTION",
        coachSuggestionId: suggestion.id,
        sourceGrantId: suggestion.sourceGrantId,
        sourceResourceType: suggestion.sourceResourceType,
        sourceResourceId: suggestion.sourceResourceId,
        sourceSnapshotHash: suggestion.sourceSnapshotHash,
      },
      title: payload.title,
      subjectId: subject?.id ?? null,
      plannedDate: payload.plannedDate ? new Date(payload.plannedDate) : null,
      estimatedMinutes: payload.estimatedMinutes,
      priority: payload.priority,
      type: payload.type,
      primaryNodeId: primaryNode?.id ?? null,
      actorId: suggestion.authorUserId,
    },
  });
  return item.id;
}

function normalizePayload(input: CoachSuggestionPayload): CoachSuggestionPayload {
  const title = input.title.trim();
  if (!title || title.length > 200) throw new ApiError("COACH_SUGGESTION_PAYLOAD_INVALID", 400);
  if (input.estimatedMinutes !== null && (!Number.isInteger(input.estimatedMinutes) || input.estimatedMinutes < 1 || input.estimatedMinutes > 1440)) {
    throw new ApiError("COACH_SUGGESTION_PAYLOAD_INVALID", 400);
  }
  if (input.plannedDate && Number.isNaN(Date.parse(input.plannedDate))) throw new ApiError("COACH_SUGGESTION_PAYLOAD_INVALID", 400);
  return {
    title,
    plannedDate: input.plannedDate ?? null,
    estimatedMinutes: input.estimatedMinutes ?? null,
    priority: input.priority?.trim().slice(0, 32) ?? null,
    type: input.type?.trim().slice(0, 64) ?? null,
    subjectId: input.subjectId?.trim() || null,
    primaryNodeId: input.primaryNodeId?.trim() || null,
  };
}

function parsePayload(value: Prisma.JsonValue): CoachSuggestionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("COACH_SUGGESTION_PAYLOAD_INVALID", 409);
  return normalizePayload(value as unknown as CoachSuggestionPayload);
}

async function assertPayloadSubject(tx: Prisma.TransactionClient, workspaceId: string, subjectId: string | null): Promise<void> {
  if (!subjectId) return;
  const subject = await tx.subject.findFirst({ where: { id: subjectId, workspaceId, archivedAt: null }, select: { id: true } });
  if (!subject) throw new ApiError("COACH_SUGGESTION_SOURCE_STALE", 409);
}

async function assertPayloadNode(tx: Prisma.TransactionClient, workspaceId: string, subjectId: string | null, nodeId: string | null): Promise<void> {
  if (!nodeId) return;
  const node = await tx.syllabusNode.findFirst({ where: { id: nodeId, archivedAt: null, subject: { workspaceId, archivedAt: null, ...(subjectId ? { id: subjectId } : {}) } }, select: { id: true } });
  if (!node) throw new ApiError("COACH_SUGGESTION_SOURCE_STALE", 409);
}

function createSourceSnapshotHash(resource: { resourceType: ShareableResourceType; resourceId: string; ownerUserId: string; revision: number | null; updatedAt: Date }): string {
  return createHash("sha256").update(stableStringify({
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    ownerUserId: resource.ownerUserId,
    revision: resource.revision,
    updatedAt: resource.updatedAt.toISOString(),
  })).digest("hex");
}

function serializeSuggestion(row: {
  id: string;
  workspaceId: string;
  authorUserId: string;
  recipientUserId: string;
  sourceGrantId: string;
  sourceResourceType: string;
  sourceResourceId: string;
  sourceSnapshotHash: string;
  payload: Prisma.JsonValue;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "REVOKED";
  revision: number;
  decidedAt: Date | null;
  planInboxItemId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CoachSuggestionDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    authorUserId: row.authorUserId,
    recipientUserId: row.recipientUserId,
    sourceGrantId: row.sourceGrantId,
    sourceResourceType: row.sourceResourceType as ShareableResourceType,
    sourceResourceId: row.sourceResourceId,
    sourceSnapshotHash: row.sourceSnapshotHash,
    payload: parsePayload(row.payload),
    status: row.status,
    revision: row.revision,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    planInboxItemId: row.planInboxItemId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function lockSuggestion(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM "CoachSuggestion" WHERE "id" = ${id} FOR UPDATE`;
}

function writeAudit(tx: Prisma.TransactionClient, actorId: string, action: string, entityId: string, metadata: Prisma.InputJsonObject) {
  return tx.auditEvent.create({ data: { actorId, action, entityType: "CoachSuggestion", entityId, metadata } });
}

function suggestionNotFound(): ApiError {
  return new ApiError("COACH_SUGGESTION_NOT_FOUND", 404);
}
