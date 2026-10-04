import {
  validateWorkspaceShareGrantTarget,
  type WorkspaceShareGrantAccess,
  type WorkspaceShareGrantScope,
  type WorkspaceRole,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { requireRbacFeature } from "@/lib/auth/feature-gates";
import { ApiError } from "@/lib/api/responses";
import {
  requireSharedResourceAccess,
  requireWorkspacePolicy,
  SHAREABLE_RESOURCE_TYPES,
  type ShareableResourceType,
} from "./policy-service";

export interface WorkspaceShareGrantDto {
  id: string;
  workspaceId: string;
  resourceOwnerUserId: string;
  scope: WorkspaceShareGrantScope;
  granteeUserId: string | null;
  granteeRole: WorkspaceRole | null;
  resourceType: ShareableResourceType;
  resourceId: string;
  access: WorkspaceShareGrantAccess;
  expiresAt: string | null;
  revokedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceShareGrantInput {
  resourceType: ShareableResourceType;
  resourceId: string;
  scope: WorkspaceShareGrantScope;
  granteeUserId?: string | null;
  granteeRole?: WorkspaceRole | null;
  access: WorkspaceShareGrantAccess;
  expiresAt?: Date | null;
}

export interface UpdateWorkspaceShareGrantInput {
  expectedRevision: number;
  access?: WorkspaceShareGrantAccess;
  expiresAt?: Date | null;
}

export async function listWorkspaceShareGrants(
  actorId: string,
  workspaceId: string,
): Promise<WorkspaceShareGrantDto[]> {
  await requireWorkspacePolicy(prisma, actorId, workspaceId, "share:manage-self");
  const grants = await prisma.workspaceShareGrant.findMany({
    where: {
      workspaceId,
      resourceOwnerUserId: actorId,
      resourceType: { in: [...SHAREABLE_RESOURCE_TYPES] },
    },
    orderBy: { createdAt: "desc" },
  });
  return grants.map(serializeGrant);
}

export async function createWorkspaceShareGrant(
  actorId: string,
  workspaceId: string,
  input: CreateWorkspaceShareGrantInput,
): Promise<WorkspaceShareGrantDto> {
  requireRbacFeature();
  let target: ReturnType<typeof validateWorkspaceShareGrantTarget>;
  try {
    target = validateWorkspaceShareGrantTarget(input);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("WORKSPACE_SHARE_GRANT_")) {
      throw new ApiError(error.message, 400);
    }
    throw error;
  }
  validateGrantExpiry(input.expiresAt);
  try {
    return await prisma.$transaction(async (tx) => {
      await requireWorkspacePolicy(tx, actorId, workspaceId, "share:manage-self");
      const access = await requireSharedResourceAccess(tx, { actorId, workspaceId, resourceType: input.resourceType, resourceId: input.resourceId });
      if (access.resource.ownerUserId !== actorId) throw grantNotFound();
      await requireEligibleTarget(tx, workspaceId, actorId, target.scope, target.granteeUserId ?? null);
      await revokeExpiredDuplicate(tx, actorId, workspaceId, input, target, new Date());
      const grant = await tx.workspaceShareGrant.create({
        data: {
          workspaceId,
          resourceOwnerUserId: actorId,
          grantedByUserId: actorId,
          scope: target.scope,
          granteeUserId: target.granteeUserId ?? null,
          granteeRole: target.granteeRole ?? null,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          access: target.access,
          expiresAt: input.expiresAt ?? null,
        },
      });
      await auditGrant(tx, actorId, "WORKSPACE_SHARE_GRANT_CREATED", grant.id, grant);
      return serializeGrant(grant);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (isPrismaConflict(error)) throw new ApiError("WORKSPACE_SHARE_GRANT_CONFLICT", 409);
    throw error;
  }
}

export async function updateWorkspaceShareGrant(
  actorId: string,
  workspaceId: string,
  grantId: string,
  input: UpdateWorkspaceShareGrantInput,
): Promise<WorkspaceShareGrantDto> {
  requireRbacFeature();
  validateGrantExpiry(input.expiresAt);
  if (input.access === undefined && input.expiresAt === undefined) throw new ApiError("INVALID_REQUEST", 400);
  try {
    return await prisma.$transaction(async (tx) => {
      await requireWorkspacePolicy(tx, actorId, workspaceId, "share:manage-self");
      const existing = await ownedGrant(tx, actorId, workspaceId, grantId);
      await requireSharedResourceAccess(tx, {
        actorId,
        workspaceId,
        resourceType: existing.resourceType as ShareableResourceType,
        resourceId: existing.resourceId,
      });
      const nextAccess = input.access ?? existing.access;
      if (nextAccess === "COACH" && existing.scope === "WORKSPACE") throw new ApiError("WORKSPACE_SHARE_GRANT_TARGET_INVALID", 400);
      const changed = await tx.workspaceShareGrant.updateMany({
        where: { id: grantId, workspaceId, resourceOwnerUserId: actorId, revokedAt: null, revision: input.expectedRevision },
        data: {
          ...(input.access === undefined ? {} : { access: input.access }),
          ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
          revision: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ApiError("WORKSPACE_SHARE_GRANT_CONFLICT", 409);
      const grant = await tx.workspaceShareGrant.findUniqueOrThrow({ where: { id: grantId } });
      await auditGrant(tx, actorId, "WORKSPACE_SHARE_GRANT_UPDATED", grant.id, grant);
      return serializeGrant(grant);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (isPrismaConflict(error)) throw new ApiError("WORKSPACE_SHARE_GRANT_CONFLICT", 409);
    throw error;
  }
}

export async function revokeWorkspaceShareGrant(
  actorId: string,
  workspaceId: string,
  grantId: string,
  expectedRevision: number,
): Promise<WorkspaceShareGrantDto> {
  requireRbacFeature();
  return prisma.$transaction(async (tx) => {
    await requireWorkspacePolicy(tx, actorId, workspaceId, "share:manage-self");
    await ownedGrant(tx, actorId, workspaceId, grantId);
    const now = new Date();
    const changed = await tx.workspaceShareGrant.updateMany({
      where: { id: grantId, workspaceId, resourceOwnerUserId: actorId, revokedAt: null, revision: expectedRevision },
      data: { revokedAt: now, revokedByUserId: actorId, revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ApiError("WORKSPACE_SHARE_GRANT_CONFLICT", 409);
    const grant = await tx.workspaceShareGrant.findUniqueOrThrow({ where: { id: grantId } });
    await auditGrant(tx, actorId, "WORKSPACE_SHARE_GRANT_REVOKED", grant.id, grant);
    return serializeGrant(grant);
  }, { isolationLevel: "Serializable" });
}

export async function listSharedWithActor(actorId: string): Promise<WorkspaceShareGrantDto[]> {
  requireRbacFeature();
  const now = new Date();
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId: actorId, status: "ACTIVE", user: { status: "ACTIVE" }, workspace: { status: "ACTIVE" } },
    select: { workspaceId: true, role: true },
  });
  const results = await Promise.all(memberships.map(async (membership) => {
    await requireWorkspacePolicy(prisma, actorId, membership.workspaceId, "workspace:read");
    return prisma.workspaceShareGrant.findMany({
      where: {
        workspaceId: membership.workspaceId,
        resourceOwnerUserId: { not: actorId },
        resourceType: { in: [...SHAREABLE_RESOURCE_TYPES] },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        AND: [{ OR: [
          { scope: "USER", granteeUserId: actorId },
          { scope: "ROLE", granteeRole: membership.role },
          { scope: "WORKSPACE", access: "VIEW" },
        ] }],
      },
      orderBy: { createdAt: "desc" },
    });
  }));
  return deduplicateGrants(results.flat()).map(serializeGrant);
}

type GrantRow = Awaited<ReturnType<typeof ownedGrant>>;

async function ownedGrant(tx: Prisma.TransactionClient, actorId: string, workspaceId: string, grantId: string) {
  const grant = await tx.workspaceShareGrant.findFirst({
    where: { id: grantId, workspaceId, resourceOwnerUserId: actorId },
  });
  if (!grant) throw grantNotFound();
  return grant;
}

async function requireEligibleTarget(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  scope: WorkspaceShareGrantScope,
  granteeUserId: string | null,
): Promise<void> {
  if (scope !== "USER") return;
  if (!granteeUserId || granteeUserId === actorId) throw new ApiError("WORKSPACE_SHARE_GRANT_TARGET_INVALID", 400);
  const target = await tx.workspaceMembership.findFirst({
    where: { workspaceId, userId: granteeUserId, status: "ACTIVE", user: { status: "ACTIVE" } },
    select: { id: true },
  });
  if (!target) throw grantNotFound();
}

async function revokeExpiredDuplicate(
  tx: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
  input: CreateWorkspaceShareGrantInput,
  target: ReturnType<typeof validateWorkspaceShareGrantTarget>,
  now: Date,
): Promise<void> {
  await tx.workspaceShareGrant.updateMany({
    where: {
      workspaceId,
      resourceOwnerUserId: actorId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      scope: target.scope,
      granteeUserId: target.granteeUserId ?? null,
      granteeRole: target.granteeRole ?? null,
      access: target.access,
      revokedAt: null,
      expiresAt: { lte: now },
    },
    data: { revokedAt: now, revokedByUserId: actorId, revision: { increment: 1 } },
  });
}

function validateGrantExpiry(expiresAt: Date | null | undefined): void {
  if (expiresAt && expiresAt <= new Date()) throw new ApiError("WORKSPACE_SHARE_GRANT_EXPIRY_INVALID", 400);
}

function serializeGrant(grant: GrantRow): WorkspaceShareGrantDto {
  return {
    id: grant.id,
    workspaceId: grant.workspaceId,
    resourceOwnerUserId: grant.resourceOwnerUserId,
    scope: grant.scope,
    granteeUserId: grant.granteeUserId,
    granteeRole: grant.granteeRole,
    resourceType: grant.resourceType as ShareableResourceType,
    resourceId: grant.resourceId,
    access: grant.access,
    expiresAt: grant.expiresAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    revision: grant.revision,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}

function deduplicateGrants<Grant extends { resourceType: string; resourceId: string }>(grants: Grant[]): Grant[] {
  const resources = new Map<string, Grant>();
  for (const grant of grants) {
    const key = `${grant.resourceType}:${grant.resourceId}`;
    if (!resources.has(key)) resources.set(key, grant);
  }
  return [...resources.values()];
}

function auditGrant(tx: Prisma.TransactionClient, actorId: string, action: string, grantId: string, grant: GrantRow) {
  return tx.auditEvent.create({
    data: {
      actorId,
      action,
      entityType: "WorkspaceShareGrant",
      entityId: grantId,
      metadata: {
        workspaceId: grant.workspaceId,
        resourceType: grant.resourceType,
        resourceId: grant.resourceId,
        scope: grant.scope,
        access: grant.access,
        revision: grant.revision,
      },
    },
  });
}

function grantNotFound(): ApiError {
  return new ApiError("WORKSPACE_SHARE_GRANT_NOT_FOUND", 404);
}

function isPrismaConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error.code === "P2002" || error.code === "P2034");
}
