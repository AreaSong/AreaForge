import {
  hasWorkspaceCapability,
  listWorkspaceCapabilities,
  type WorkspaceCapability,
  type WorkspaceRole,
  type WorkspaceShareGrantAccess,
  type WorkspaceShareGrantScope,
} from "@areaforge/core";
import type { Prisma } from "@areaforge/db";
import { requireRbacFeature } from "@/lib/auth/feature-gates";
import { ApiError } from "@/lib/api/responses";

export const SHAREABLE_RESOURCE_TYPES = ["NOTE", "MISTAKE", "ATTACHMENT"] as const;
export type ShareableResourceType = (typeof SHAREABLE_RESOURCE_TYPES)[number];

type PolicyClient = Pick<
  Prisma.TransactionClient,
  "workspaceMembership" | "note" | "mistake" | "attachment" | "workspaceShareGrant"
>;

export interface WorkspacePolicyContext {
  actorId: string;
  workspaceId: string;
  ownerUserId: string;
  role: WorkspaceRole;
  capabilities: WorkspaceCapability[];
}

export interface SharedResourceIdentity {
  workspaceId: string;
  ownerUserId: string;
  resourceType: ShareableResourceType;
  resourceId: string;
  revision: number | null;
  updatedAt: Date;
}

export interface ActiveGrantCandidate {
  scope: WorkspaceShareGrantScope;
  granteeUserId: string | null;
  granteeRole: WorkspaceRole | null;
  access: WorkspaceShareGrantAccess;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

export async function requireWorkspacePolicy(
  client: PolicyClient,
  actorId: string,
  workspaceId: string,
  capability?: WorkspaceCapability,
): Promise<WorkspacePolicyContext> {
  requireRbacFeature();
  const [membership, activeOwners] = await Promise.all([
    client.workspaceMembership.findFirst({
      where: {
        workspaceId,
        userId: actorId,
        status: "ACTIVE",
        user: { status: "ACTIVE" },
        workspace: { status: "ACTIVE" },
      },
      select: { role: true, workspace: { select: { userId: true } } },
    }),
    client.workspaceMembership.findMany({
      where: { workspaceId, status: "ACTIVE", role: "OWNER" },
      select: { userId: true },
      take: 2,
    }),
  ]);
  if (!membership || activeOwners.length !== 1 || activeOwners[0]?.userId !== membership.workspace.userId) {
    throw policyNotFound();
  }
  if ((membership.role === "OWNER") !== (membership.workspace.userId === actorId)) {
    throw policyNotFound();
  }
  const role = membership.role as WorkspaceRole;
  if (capability && !hasWorkspaceCapability(role, capability)) throw policyNotFound();
  return {
    actorId,
    workspaceId,
    ownerUserId: membership.workspace.userId,
    role,
    capabilities: listWorkspaceCapabilities(role),
  };
}

export async function requireSharedResourceAccess(
  client: PolicyClient,
  input: {
    actorId: string;
    workspaceId: string;
    resourceType: ShareableResourceType;
    resourceId: string;
    access?: WorkspaceShareGrantAccess;
    now?: Date;
  },
): Promise<{ context: WorkspacePolicyContext; resource: SharedResourceIdentity; grantId: string | null }> {
  const context = await requireWorkspacePolicy(client, input.actorId, input.workspaceId, "workspace:read");
  const resource = await resolveSharedResource(client, input.resourceType, input.resourceId, input.workspaceId);
  if (!resource) throw policyNotFound();
  if (resource.ownerUserId === input.actorId) return { context, resource, grantId: null };

  const access = input.access ?? "VIEW";
  const now = input.now ?? new Date();
  const grants = await client.workspaceShareGrant.findMany({
    where: {
      workspaceId: input.workspaceId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      resourceOwnerUserId: resource.ownerUserId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      id: true,
      scope: true,
      granteeUserId: true,
      granteeRole: true,
      access: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  const grant = grants.find((candidate) => grantAllowsActor(candidate, context, access, now));
  if (!grant) throw policyNotFound();
  return { context, resource, grantId: grant.id };
}

export function grantAllowsActor(
  grant: ActiveGrantCandidate,
  actor: Pick<WorkspacePolicyContext, "actorId" | "role">,
  requiredAccess: WorkspaceShareGrantAccess,
  now = new Date(),
): boolean {
  if (grant.revokedAt || (grant.expiresAt && grant.expiresAt <= now)) return false;
  if (requiredAccess === "COACH" && (grant.access !== "COACH" || actor.role !== "COACH")) return false;
  if (grant.scope === "USER") return grant.granteeUserId === actor.actorId && !grant.granteeRole;
  if (grant.scope === "ROLE") return !grant.granteeUserId && grant.granteeRole === actor.role;
  return grant.scope === "WORKSPACE"
    && requiredAccess === "VIEW"
    && grant.access === "VIEW"
    && !grant.granteeUserId
    && !grant.granteeRole;
}

async function resolveSharedResource(
  client: PolicyClient,
  resourceType: ShareableResourceType,
  resourceId: string,
  workspaceId: string,
): Promise<SharedResourceIdentity | null> {
  if (resourceType === "NOTE") {
    const note = await client.note.findFirst({
      where: { id: resourceId, archivedAt: null, subject: { workspaceId, archivedAt: null } },
      select: { id: true, ownerUserId: true, revision: true, updatedAt: true },
    });
    return note && { workspaceId, ownerUserId: note.ownerUserId, resourceType, resourceId: note.id, revision: note.revision, updatedAt: note.updatedAt };
  }
  if (resourceType === "MISTAKE") {
    const mistake = await client.mistake.findFirst({
      where: { id: resourceId, archivedAt: null, subject: { workspaceId, archivedAt: null } },
      select: { id: true, ownerUserId: true, updatedAt: true },
    });
    return mistake && { workspaceId, ownerUserId: mistake.ownerUserId, resourceType, resourceId: mistake.id, revision: null, updatedAt: mistake.updatedAt };
  }
  const attachment = await client.attachment.findFirst({
    where: {
      id: resourceId,
      status: "READY",
      OR: [
        { note: { archivedAt: null, subject: { workspaceId, archivedAt: null } } },
        { studyResource: { workspaceId, archivedAt: null } },
      ],
    },
    select: {
      id: true,
      ownerUserId: true,
      updatedAt: true,
      note: { select: { subject: { select: { workspaceId: true } } } },
      studyResource: { select: { workspaceId: true, archivedAt: true } },
    },
  });
  if (!attachment) return null;
  const scopes = [attachment.note?.subject.workspaceId, attachment.studyResource?.workspaceId].filter(Boolean);
  if (scopes.some((scope) => scope !== workspaceId)) return null;
  return { workspaceId, ownerUserId: attachment.ownerUserId, resourceType, resourceId: attachment.id, revision: null, updatedAt: attachment.updatedAt };
}

function policyNotFound(): ApiError {
  return new ApiError("WORKSPACE_RESOURCE_NOT_FOUND", 404);
}
