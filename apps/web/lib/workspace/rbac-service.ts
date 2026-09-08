import { WORKSPACE_ROLES, type WorkspaceCapability, type WorkspaceRole } from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { requireFreshAccountSession } from "@/lib/auth/account-service";
import { requireRbacFeature } from "@/lib/auth/feature-gates";
import type { CurrentUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/responses";
import { requireWorkspacePolicy } from "./policy-service";

export interface WorkspaceCapabilityDto {
  workspaceId: string;
  role: WorkspaceRole;
  capabilities: WorkspaceCapability[];
}

export interface WorkspaceRoleUpdateDto {
  membershipId: string;
  userId: string;
  role: WorkspaceRole;
  revision: number;
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return WORKSPACE_ROLES.some((role) => role === value);
}

export async function getWorkspaceCapabilities(
  actorId: string,
  workspaceId: string,
): Promise<WorkspaceCapabilityDto> {
  const context = await requireWorkspacePolicy(prisma, actorId, workspaceId, "workspace:read");
  return { workspaceId, role: context.role, capabilities: context.capabilities };
}

export async function updateWorkspaceMemberRole(
  actor: CurrentUser,
  workspaceId: string,
  membershipId: string,
  nextRole: Exclude<WorkspaceRole, "OWNER">,
  expectedRevision: number,
): Promise<WorkspaceRoleUpdateDto> {
  requireRbacFeature();
  return prisma.$transaction(async (tx) => {
    await requireFreshAccountSession(tx, actor);
    await requireWorkspacePolicy(tx, actor.id, workspaceId, "member:role");
    const target = await tx.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId, status: "ACTIVE" },
      select: { id: true, userId: true, role: true, revision: true },
    });
    if (!target || target.role === "OWNER") throw roleTargetNotFound();
    if (target.userId === actor.id) throw new ApiError("WORKSPACE_ROLE_SELF_CHANGE_FORBIDDEN", 409);
    if (target.revision !== expectedRevision) throw new ApiError("WORKSPACE_MEMBERSHIP_CONFLICT", 409);
    if (target.role === nextRole) {
      return {
        membershipId: target.id,
        userId: target.userId,
        role: nextRole,
        revision: target.revision,
      };
    }

    const changed = await tx.workspaceMembership.updateMany({
      where: {
        id: target.id,
        workspaceId,
        status: "ACTIVE",
        role: target.role,
        revision: expectedRevision,
      },
      data: { role: nextRole, revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ApiError("WORKSPACE_MEMBERSHIP_CONFLICT", 409);
    const updated = await tx.workspaceMembership.findUniqueOrThrow({ where: { id: target.id } });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "WORKSPACE_MEMBER_ROLE_CHANGED",
        entityType: "WorkspaceMembership",
        entityId: target.id,
        metadata: {
          workspaceId,
          targetUserId: target.userId,
          fromRole: target.role,
          toRole: updated.role,
          revision: updated.revision,
        },
      },
    });
    return {
      membershipId: updated.id,
      userId: updated.userId,
      role: updated.role,
      revision: updated.revision,
    };
  }, { isolationLevel: "Serializable" });
}

function roleTargetNotFound(): ApiError {
  return new ApiError("WORKSPACE_MEMBER_NOT_FOUND", 404);
}
