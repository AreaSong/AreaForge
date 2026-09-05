import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isReauthenticationFresh,
  isPasswordPolicySatisfied,
  isSessionUsable,
  verifyPassword,
} from "@areaforge/auth";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAuthEnv } from "./env";
import type { CurrentUser } from "./session";

export interface AuthSessionDto {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  reauthenticatedAt: string | null;
  current: boolean;
}

export async function listDeviceSessions(actor: CurrentUser): Promise<AuthSessionDto[]> {
  const sessions = await prisma.authSession.findMany({
    where: { userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      deviceLabel: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      reauthenticatedAt: true,
    },
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
  });
  return sessions.map((session) => ({
    id: session.id,
    deviceLabel: session.deviceLabel ?? "未知设备",
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt?.toISOString() ?? null,
    expiresAt: session.expiresAt.toISOString(),
    reauthenticatedAt: session.reauthenticatedAt?.toISOString() ?? null,
    current: session.id === actor.sessionId,
  }));
}

export async function reauthenticateSession(actor: CurrentUser, password: string): Promise<Date> {
  const account = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { passwordHash: true, status: true, authRevision: true },
  });
  const valid = account?.status === "ACTIVE" && await verifyPassword(password, account.passwordHash);
  if (!account || !valid) {
    await recordReauthenticationAudit(actor.id, actor.sessionId, "AUTH_REAUTHENTICATION_FAILED");
    throw new ApiError("CURRENT_PASSWORD_INVALID", 401);
  }

  const now = new Date();
  const changed = await prisma.authSession.updateMany({
    where: {
      id: actor.sessionId,
      userId: actor.id,
      authRevision: account.authRevision,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { reauthenticatedAt: now },
  });
  if (changed.count !== 1) throw new ApiError("UNAUTHORIZED", 401);
  await recordReauthenticationAudit(actor.id, actor.sessionId, "AUTH_REAUTHENTICATED");
  return now;
}

export async function revokeDeviceSession(actor: CurrentUser, sessionId: string): Promise<void> {
  if (sessionId === actor.sessionId) {
    throw new ApiError("CURRENT_SESSION_REVOKE_REQUIRES_LOGOUT", 409);
  }
  await prisma.$transaction(async (tx) => {
    await requireFreshAccountSession(tx, actor);
    const revokedAt = new Date();
    const changed = await tx.authSession.updateMany({
      where: { id: sessionId, userId: actor.id, revokedAt: null, expiresAt: { gt: revokedAt } },
      data: { revokedAt, revokedReason: "USER_REVOKED_DEVICE" },
    });
    if (changed.count !== 1) throw new ApiError("AUTH_SESSION_NOT_FOUND", 404);
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "AUTH_SESSION_REVOKED",
        entityType: "AuthSession",
        entityId: sessionId,
        metadata: { reason: "user_revoked_device" },
      },
    });
  });
}

export async function revokeOtherDeviceSessions(actor: CurrentUser): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await requireFreshAccountSession(tx, actor);
    const now = new Date();
    const changed = await tx.authSession.updateMany({
      where: { userId: actor.id, id: { not: actor.sessionId }, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, revokedReason: "USER_REVOKED_OTHER_DEVICES" },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "AUTH_OTHER_SESSIONS_REVOKED",
        entityType: "User",
        entityId: actor.id,
        metadata: { revokedSessionCount: changed.count },
      },
    });
    return changed.count;
  });
}

export async function changeAccountPassword(
  actor: CurrentUser,
  currentPassword: string,
  nextPassword: string,
): Promise<string> {
  if (!isPasswordPolicySatisfied(nextPassword)) {
    throw new ApiError("PASSWORD_POLICY_NOT_SATISFIED", 400);
  }
  const account = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { passwordHash: true, status: true, authRevision: true },
  });
  if (!account || account.status !== "ACTIVE" || !await verifyPassword(currentPassword, account.passwordHash)) {
    throw new ApiError("CURRENT_PASSWORD_INVALID", 401);
  }
  if (await verifyPassword(nextPassword, account.passwordHash)) {
    throw new ApiError("PASSWORD_MUST_CHANGE", 400);
  }

  const nextPasswordHash = await hashPassword(nextPassword);
  return applyPasswordChange(actor, account.authRevision, nextPasswordHash);
}

async function applyPasswordChange(
  actor: CurrentUser,
  expectedAuthRevision: number,
  nextPasswordHash: string,
): Promise<string> {
  const nextToken = createSessionToken();
  const nextTokenHash = hashSessionToken(nextToken, getAuthEnv().AUTH_SESSION_SECRET);
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const currentSession = await tx.authSession.findFirst({
      where: {
        id: actor.sessionId,
        userId: actor.id,
        authRevision: expectedAuthRevision,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        deviceLabel: true,
        ipHash: true,
        userAgentHash: true,
        expiresAt: true,
      },
    });
    if (!currentSession) throw new ApiError("UNAUTHORIZED", 401);
    const changed = await tx.user.updateMany({
      where: { id: actor.id, status: "ACTIVE", authRevision: expectedAuthRevision },
      data: { passwordHash: nextPasswordHash, passwordChangedAt: now, authRevision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ApiError("AUTH_REVISION_CONFLICT", 409);

    const nextAuthRevision = expectedAuthRevision + 1;
    await tx.authSession.updateMany({
      where: { userId: actor.id, revokedAt: null },
      data: { revokedAt: now, revokedReason: "PASSWORD_CHANGED" },
    });
    await tx.authSession.create({
      data: {
        userId: actor.id,
        tokenHash: nextTokenHash,
        authRevision: nextAuthRevision,
        deviceLabel: currentSession.deviceLabel,
        ipHash: currentSession.ipHash,
        userAgentHash: currentSession.userAgentHash,
        lastSeenAt: now,
        reauthenticatedAt: now,
        expiresAt: currentSession.expiresAt,
      },
    });
    await tx.authActionToken.updateMany({
      where: { userId: actor.id, purpose: "PASSWORD_RESET", consumedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "AUTH_PASSWORD_CHANGED",
        entityType: "User",
        entityId: actor.id,
        metadata: { revokedOtherSessions: true, authRevision: nextAuthRevision },
      },
    });
  });
  return nextToken;
}

function recordReauthenticationAudit(
  actorId: string,
  sessionId: string,
  action: "AUTH_REAUTHENTICATED" | "AUTH_REAUTHENTICATION_FAILED",
): Promise<unknown> {
  return prisma.auditEvent.create({
    data: { actorId, action, entityType: "AuthSession", entityId: sessionId },
  });
}

async function requireFreshAccountSession(tx: Prisma.TransactionClient, actor: CurrentUser): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id = ${actor.sessionId} FOR UPDATE`;
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
