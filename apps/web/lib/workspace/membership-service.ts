import {
  createWorkspaceInvitationToken,
  hashWorkspaceInvitationToken,
  hashPassword,
  isReauthenticationFresh,
  isSessionUsable,
  isPasswordPolicySatisfied,
  isWorkspaceInvitationUsable,
} from "@areaforge/auth";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAuthEnv } from "@/lib/auth/env";
import { sendAuthMail } from "@/lib/auth/mail";
import { normalizeEmail, type CurrentUser } from "@/lib/auth/session";

export interface WorkspaceMemberDto {
  id: string;
  userId: string;
  email: string;
  role: "OWNER" | "MEMBER";
  status: "ACTIVE" | "LEFT" | "REMOVED";
  revision: number;
  joinedAt: string;
}

export interface WorkspaceInvitationDto {
  id: string;
  workspaceId: string;
  email: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  revision: number;
  expiresAt: string;
  createdAt: string;
}

export interface WorkspaceInvitationPreviewDto {
  workspaceName: string;
  invitedEmail: string;
  expiresAt: string;
}

export async function listWorkspaceMembers(actorId: string, workspaceId: string): Promise<WorkspaceMemberDto[]> {
  requireMultiUser();
  const actorMembership = await requireMembership(prisma, actorId, workspaceId);
  const rows = await prisma.workspaceMembership.findMany({
    where: actorMembership.role === "OWNER"
      ? { workspaceId, status: "ACTIVE" }
      : { id: actorMembership.id, workspaceId, status: "ACTIVE" },
    include: { user: { select: { email: true } } },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    email: row.user.email,
    role: row.role,
    status: row.status,
    revision: row.revision,
    joinedAt: row.joinedAt.toISOString(),
  }));
}

export async function listWorkspaceInvitations(
  actorId: string,
  workspaceId: string,
): Promise<WorkspaceInvitationDto[]> {
  requireMultiUser();
  await requireOwner(prisma, actorId, workspaceId);
  const rows = await prisma.workspaceInvitation.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(serializeInvitation);
}

export async function previewWorkspaceInvitation(token: string): Promise<WorkspaceInvitationPreviewDto> {
  requireMultiUser();
  const tokenHash = hashWorkspaceInvitationToken(token, actionTokenSecret());
  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { tokenHash },
    include: { workspace: { select: { name: true, status: true } } },
  });
  if (!invitation || invitation.workspace.status !== "ACTIVE" || !isWorkspaceInvitationUsable(invitation)) {
    throw new ApiError("WORKSPACE_INVITATION_NOT_FOUND", 404);
  }
  return {
    workspaceName: invitation.workspace.name,
    invitedEmail: invitation.emailNormalized,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

export async function createWorkspaceInvitation(
  actor: CurrentUser,
  workspaceId: string,
  emailInput: string,
): Promise<WorkspaceInvitationDto> {
  requireMultiUser();
  const email = normalizeEmail(emailInput);
  const rawToken = createWorkspaceInvitationToken();
  const tokenHash = hashWorkspaceInvitationToken(rawToken, actionTokenSecret());
  const expiresAt = new Date(Date.now() + getAuthEnv().AUTH_INVITATION_TTL_SECONDS * 1000);
  let invitation;
  try {
    invitation = await prisma.$transaction(async (tx) => {
      await requireFreshActorSession(tx, actor);
      await requireActiveOwner(tx, actor.id, workspaceId);
      await rejectExistingMember(tx, email, workspaceId);
      await tx.workspaceInvitation.updateMany({
        where: { workspaceId, emailNormalized: email, status: "PENDING", expiresAt: { lte: new Date() } },
        data: { status: "REVOKED", revokedAt: new Date(), revision: { increment: 1 } },
      });
      const created = await tx.workspaceInvitation.create({
        data: { workspaceId, emailNormalized: email, tokenHash, expiresAt, invitedByUserId: actor.id },
      });
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          action: "WORKSPACE_INVITATION_CREATED",
          entityType: "WorkspaceInvitation",
          entityId: created.id,
          metadata: { workspaceId, emailHash: tokenSafeEmailHash(email) },
        },
      });
      return created;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (isPrismaConcurrencyConflict(error)) throw new ApiError("WORKSPACE_INVITATION_CONFLICT", 409);
    throw error;
  }

  try {
    const actionUrl = new URL("/invitations/accept", getAuthEnv().APP_URL);
    actionUrl.hash = new URLSearchParams({ token: rawToken }).toString();
    await sendAuthMail({ to: email, purpose: "INVITATION", actionUrl: actionUrl.toString() });
  } catch {
    await revokeFailedInvitation(actor.id, invitation.id);
    throw new ApiError("AUTH_MAIL_DELIVERY_FAILED", 503);
  }
  return serializeInvitation(invitation);
}

export async function revokeWorkspaceInvitation(
  actor: CurrentUser,
  workspaceId: string,
  invitationId: string,
  expectedRevision: number,
): Promise<WorkspaceInvitationDto> {
  requireMultiUser();
  return prisma.$transaction(async (tx) => {
    await requireFreshActorSession(tx, actor);
    await requireOwner(tx, actor.id, workspaceId);
    const now = new Date();
    const changed = await tx.workspaceInvitation.updateMany({
      where: { id: invitationId, workspaceId, status: "PENDING", revision: expectedRevision },
      data: { status: "REVOKED", revokedAt: now, revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ApiError("WORKSPACE_INVITATION_NOT_FOUND", 404);
    const updated = await tx.workspaceInvitation.findUniqueOrThrow({ where: { id: invitationId } });
    await auditMembershipAction(tx, actor.id, "WORKSPACE_INVITATION_REVOKED", "WorkspaceInvitation", invitationId);
    return serializeInvitation(updated);
  }, { isolationLevel: "Serializable" });
}

export async function acceptWorkspaceInvitation(input: {
  token: string;
  actor: CurrentUser | null;
  password?: string;
}): Promise<{ user: { id: string; email: string; authRevision: number }; workspaceId: string; createdAccount: boolean }> {
  requireMultiUser();
  const tokenHash = hashWorkspaceInvitationToken(input.token, actionTokenSecret());
  try {
    return await prisma.$transaction(async (tx) => {
      const invitation = await tx.workspaceInvitation.findUnique({
        where: { tokenHash },
        include: { workspace: { select: { status: true } } },
      });
      if (!invitation || invitation.workspace.status !== "ACTIVE" || !isWorkspaceInvitationUsable(invitation)) {
        throw invitationContinuationRequired();
      }
      const resolved = await resolveInvitationUser(tx, invitation.emailNormalized, input.actor, input.password);
      const acceptedAt = new Date();
      const changed = await tx.workspaceInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING", revision: invitation.revision, expiresAt: { gt: acceptedAt } },
        data: {
          status: "ACCEPTED",
          acceptedAt,
          acceptedByUserId: resolved.user.id,
          revision: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw invitationContinuationRequired();
      await tx.workspaceMembership.upsert({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: resolved.user.id } },
        create: {
          workspaceId: invitation.workspaceId,
          userId: resolved.user.id,
          role: "MEMBER",
          invitedByUserId: invitation.invitedByUserId,
        },
        update: {
          role: "MEMBER",
          status: "ACTIVE",
          invitedByUserId: invitation.invitedByUserId,
          joinedAt: acceptedAt,
          leftAt: null,
          removedAt: null,
          revision: { increment: 1 },
        },
      });
      await auditMembershipAction(tx, resolved.user.id, "WORKSPACE_INVITATION_ACCEPTED", "WorkspaceInvitation", invitation.id);
      return { ...resolved, workspaceId: invitation.workspaceId };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (isPrismaConcurrencyConflict(error)) throw invitationContinuationRequired();
    throw error;
  }
}

export async function rejectWorkspaceInvitation(actor: CurrentUser, token: string): Promise<void> {
  requireMultiUser();
  const tokenHash = hashWorkspaceInvitationToken(token, actionTokenSecret());
  await prisma.$transaction(async (tx) => {
    const invitation = await tx.workspaceInvitation.findUnique({ where: { tokenHash } });
    if (!invitation || normalizeEmail(actor.email) !== invitation.emailNormalized || !isWorkspaceInvitationUsable(invitation)) {
      throw invitationContinuationRequired();
    }
    const changed = await tx.workspaceInvitation.updateMany({
      where: { id: invitation.id, status: "PENDING", revision: invitation.revision },
      data: { status: "REVOKED", revokedAt: new Date(), revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw invitationContinuationRequired();
    await auditMembershipAction(tx, actor.id, "WORKSPACE_INVITATION_REJECTED", "WorkspaceInvitation", invitation.id);
  }, { isolationLevel: "Serializable" });
}

export async function removeWorkspaceMember(
  actor: CurrentUser,
  workspaceId: string,
  membershipId: string,
  expectedRevision: number,
): Promise<void> {
  requireMultiUser();
  await prisma.$transaction(async (tx) => {
    await requireFreshActorSession(tx, actor);
    await requireOwner(tx, actor.id, workspaceId);
    const member = await tx.workspaceMembership.findFirst({ where: { id: membershipId, workspaceId, status: "ACTIVE" } });
    if (!member || member.role === "OWNER") throw new ApiError("WORKSPACE_MEMBER_NOT_FOUND", 404);
    const changed = await tx.workspaceMembership.updateMany({
      where: { id: membershipId, workspaceId, status: "ACTIVE", role: "MEMBER", revision: expectedRevision },
      data: { status: "REMOVED", removedAt: new Date(), revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ApiError("WORKSPACE_MEMBERSHIP_CONFLICT", 409);
    await revokeMemberSelection(tx, member.userId, workspaceId);
    await auditMembershipAction(tx, actor.id, "WORKSPACE_MEMBER_REMOVED", "WorkspaceMembership", membershipId);
  }, { isolationLevel: "Serializable" });
}

export async function leaveWorkspace(actor: CurrentUser, workspaceId: string, expectedRevision: number): Promise<void> {
  requireMultiUser();
  await prisma.$transaction(async (tx) => {
    await requireFreshActorSession(tx, actor);
    const membership = await requireMembership(tx, actor.id, workspaceId);
    if (membership.role === "OWNER") throw new ApiError("LAST_OWNER_CANNOT_LEAVE", 409);
    const changed = await tx.workspaceMembership.updateMany({
      where: { id: membership.id, status: "ACTIVE", revision: expectedRevision },
      data: { status: "LEFT", leftAt: new Date(), revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ApiError("WORKSPACE_MEMBERSHIP_CONFLICT", 409);
    await revokeMemberSelection(tx, actor.id, workspaceId);
    await auditMembershipAction(tx, actor.id, "WORKSPACE_MEMBER_LEFT", "WorkspaceMembership", membership.id);
  }, { isolationLevel: "Serializable" });
}

export async function transferWorkspaceOwnership(
  actor: CurrentUser,
  workspaceId: string,
  targetMembershipId: string,
  expectedOwnerRevision: number,
  expectedTargetRevision: number,
): Promise<void> {
  requireMultiUser();
  await prisma.$transaction(async (tx) => {
    await requireFreshActorSession(tx, actor);
    const owner = await requireActiveOwner(tx, actor.id, workspaceId);
    const target = await tx.workspaceMembership.findFirst({
      where: { id: targetMembershipId, workspaceId, role: "MEMBER", status: "ACTIVE" },
    });
    if (!target) throw new ApiError("WORKSPACE_MEMBER_NOT_FOUND", 404);
    const workspace = await tx.examWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const actorFallbackWorkspaceId = await assertTransferSafe(tx, actor.id, target.userId, workspaceId, workspace.stableKey);
    const ownerChanged = await tx.workspaceMembership.updateMany({
      where: { id: owner.id, role: "OWNER", status: "ACTIVE", revision: expectedOwnerRevision },
      data: { role: "MEMBER", revision: { increment: 1 } },
    });
    const targetChanged = await tx.workspaceMembership.updateMany({
      where: { id: target.id, role: "MEMBER", status: "ACTIVE", revision: expectedTargetRevision },
      data: { role: "OWNER", revision: { increment: 1 } },
    });
    if (ownerChanged.count !== 1 || targetChanged.count !== 1) throw new ApiError("WORKSPACE_MEMBERSHIP_CONFLICT", 409);
    await tx.examWorkspace.update({ where: { id: workspaceId }, data: { userId: target.userId, revision: { increment: 1 } } });
    await tx.workspaceSelection.upsert({
      where: { userId: target.userId },
      create: { userId: target.userId, workspaceId },
      update: { workspaceId, selectedAt: new Date(), revision: { increment: 1 } },
    });
    await tx.workspaceSelection.upsert({
      where: { userId: actor.id },
      create: { userId: actor.id, workspaceId: actorFallbackWorkspaceId },
      update: { workspaceId: actorFallbackWorkspaceId, selectedAt: new Date(), revision: { increment: 1 } },
    });
    await auditMembershipAction(tx, actor.id, "WORKSPACE_OWNERSHIP_TRANSFERRED", "ExamWorkspace", workspaceId);
  }, { isolationLevel: "Serializable" });
}

type MembershipClient = Pick<Prisma.TransactionClient, "workspaceMembership">;

async function requireFreshActorSession(tx: Prisma.TransactionClient, actor: CurrentUser): Promise<void> {
  const now = new Date();
  const session = await tx.authSession.findFirst({
    where: { id: actor.sessionId, userId: actor.id },
    select: {
      authRevision: true,
      expiresAt: true,
      revokedAt: true,
      reauthenticatedAt: true,
      user: { select: { status: true, authRevision: true } },
    },
  });
  if (!session || !isSessionUsable({
    accountStatus: session.user.status,
    accountAuthRevision: session.user.authRevision,
    sessionAuthRevision: session.authRevision,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    now,
  }) || !isReauthenticationFresh(
    session.reauthenticatedAt,
    now,
    getAuthEnv().AUTH_REAUTH_MAX_AGE_SECONDS * 1000,
  )) {
    throw new ApiError("REAUTHENTICATION_REQUIRED", 403);
  }
}

async function requireMembership(client: MembershipClient, actorId: string, workspaceId: string) {
  const membership = await client.workspaceMembership.findFirst({
    where: { workspaceId, userId: actorId, status: "ACTIVE" },
  });
  if (!membership) throw new ApiError("WORKSPACE_NOT_FOUND", 404);
  return membership;
}

async function requireOwner(client: MembershipClient, actorId: string, workspaceId: string) {
  const membership = await requireMembership(client, actorId, workspaceId);
  if (membership.role !== "OWNER") throw new ApiError("WORKSPACE_NOT_FOUND", 404);
  return membership;
}

async function requireActiveOwner(client: MembershipClient, actorId: string, workspaceId: string) {
  const membership = await client.workspaceMembership.findFirst({
    where: {
      workspaceId,
      userId: actorId,
      role: "OWNER",
      status: "ACTIVE",
      workspace: { status: "ACTIVE", userId: actorId },
    },
  });
  if (!membership) throw new ApiError("WORKSPACE_NOT_FOUND", 404);
  return membership;
}

async function resolveInvitationUser(
  tx: Prisma.TransactionClient,
  email: string,
  actor: CurrentUser | null,
  password?: string,
) {
  const existing = await tx.user.findUnique({ where: { email } });
  if (existing) {
    if (!actor || actor.id !== existing.id || normalizeEmail(actor.email) !== email) {
      throw invitationContinuationRequired();
    }
    if (existing.status !== "ACTIVE") throw invitationContinuationRequired();
    return { user: existing, createdAccount: false };
  }
  if (actor || !password || !isPasswordPolicySatisfied(password)) {
    throw invitationContinuationRequired();
  }
  const user = await tx.user.create({
    data: { email, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
  });
  const personalWorkspace = await tx.examWorkspace.create({
    data: {
      userId: user.id,
      stableKey: "personal",
      name: "个人学习空间",
      status: "ACTIVE",
    },
  });
  await tx.workspaceMembership.create({
    data: { workspaceId: personalWorkspace.id, userId: user.id, role: "OWNER", status: "ACTIVE" },
  });
  await tx.workspaceSelection.create({
    data: { userId: user.id, workspaceId: personalWorkspace.id },
  });
  await tx.auditEvent.create({
    data: {
      actorId: user.id,
      action: "AUTH_INVITED_ACCOUNT_CREATED",
      entityType: "User",
      entityId: user.id,
      metadata: { personalWorkspaceId: personalWorkspace.id },
    },
  });
  return { user, createdAccount: true };
}

function invitationContinuationRequired(): ApiError {
  return new ApiError("WORKSPACE_INVITATION_CONTINUATION_REQUIRED", 409);
}

async function rejectExistingMember(tx: Prisma.TransactionClient, email: string, workspaceId: string): Promise<void> {
  const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return;
  const existing = await tx.workspaceMembership.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { status: true },
  });
  if (existing?.status === "ACTIVE") throw new ApiError("WORKSPACE_MEMBER_ALREADY_EXISTS", 409);
}

async function assertTransferSafe(
  tx: Prisma.TransactionClient,
  actorId: string,
  targetUserId: string,
  workspaceId: string,
  stableKey: string,
): Promise<string> {
  const [actorOtherWorkspace, targetConflict] = await Promise.all([
    tx.examWorkspace.findFirst({ where: { userId: actorId, status: "ACTIVE", id: { not: workspaceId } }, select: { id: true } }),
    tx.examWorkspace.findFirst({ where: { userId: targetUserId, stableKey, id: { not: workspaceId } }, select: { id: true } }),
  ]);
  if (!actorOtherWorkspace) throw new ApiError("PERSONAL_WORKSPACE_REQUIRED", 409);
  if (targetConflict) throw new ApiError("WORKSPACE_STABLE_KEY_CONFLICT", 409);
  return actorOtherWorkspace.id;
}

async function revokeMemberSelection(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<void> {
  const selection = await tx.workspaceSelection.findUnique({ where: { userId } });
  if (selection?.workspaceId !== workspaceId) return;
  const fallback = await tx.workspaceMembership.findFirst({
    where: {
      userId,
      role: "OWNER",
      status: "ACTIVE",
      workspaceId: { not: workspaceId },
      workspace: { status: "ACTIVE", userId },
    },
    orderBy: { joinedAt: "asc" },
    select: { workspaceId: true },
  });
  if (!fallback) {
    await tx.workspaceSelection.delete({ where: { userId } });
    return;
  }
  await tx.workspaceSelection.update({
    where: { userId },
    data: { workspaceId: fallback.workspaceId, selectedAt: new Date(), revision: { increment: 1 } },
  });
}

async function revokeFailedInvitation(actorId: string, invitationId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.workspaceInvitation.updateMany({
      where: { id: invitationId, status: "PENDING" },
      data: { status: "REVOKED", revokedAt: new Date(), revision: { increment: 1 } },
    });
    await auditMembershipAction(tx, actorId, "WORKSPACE_INVITATION_DELIVERY_FAILED", "WorkspaceInvitation", invitationId);
  });
}

function serializeInvitation(row: {
  id: string;
  workspaceId: string;
  emailNormalized: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  revision: number;
  expiresAt: Date;
  createdAt: Date;
}): WorkspaceInvitationDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.emailNormalized,
    status: row.status,
    revision: row.revision,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function auditMembershipAction(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
): Promise<unknown> {
  return tx.auditEvent.create({ data: { actorId, action, entityType, entityId } });
}

function actionTokenSecret(): string {
  const secret = getAuthEnv().AUTH_ACTION_TOKEN_SECRET;
  if (!secret) throw new ApiError("AUTH_ACTION_TOKEN_NOT_CONFIGURED", 503);
  return secret;
}

function requireMultiUser(): void {
  if (!getAuthEnv().AUTH_MULTI_USER_ENABLED) throw new ApiError("MULTI_USER_DISABLED", 404);
}

function tokenSafeEmailHash(email: string): string {
  return hashWorkspaceInvitationToken(email, actionTokenSecret());
}

function isPrismaConcurrencyConflict(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error.code === "P2002" || error.code === "P2034");
}
