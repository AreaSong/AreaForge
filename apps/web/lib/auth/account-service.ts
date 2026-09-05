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
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await requireUsableAccountSession(tx, actor, now);
    const sessions = await tx.authSession.findMany({
      where: { userId: actor.id, revokedAt: null, expiresAt: { gt: now } },
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
  });
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

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await requireUsableAccountSession(tx, actor, now);
    const currentAccount = await tx.user.findUnique({
      where: { id: actor.id },
      select: { passwordHash: true, authRevision: true },
    });
    if (
      !currentAccount
      || currentAccount.authRevision !== account.authRevision
      || currentAccount.passwordHash !== account.passwordHash
    ) {
      throw new ApiError("UNAUTHORIZED", 401);
    }
    await tx.authSession.update({ where: { id: actor.sessionId }, data: { reauthenticatedAt: now } });
    await recordReauthenticationAudit(actor.id, actor.sessionId, "AUTH_REAUTHENTICATED", tx);
    return now;
  });
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
  return applyPasswordChange(actor, account.authRevision, account.passwordHash, nextPasswordHash);
}

async function applyPasswordChange(
  actor: CurrentUser,
  expectedAuthRevision: number,
  expectedPasswordHash: string,
  nextPasswordHash: string,
): Promise<string> {
  const nextToken = createSessionToken();
  const nextTokenHash = hashSessionToken(nextToken, getAuthEnv().AUTH_SESSION_SECRET);
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await requireUsableAccountSession(tx, actor, now);
    const account = await tx.user.findUnique({
      where: { id: actor.id },
      select: { passwordHash: true, authRevision: true },
    });
    if (
      !account
      || account.authRevision !== expectedAuthRevision
      || account.passwordHash !== expectedPasswordHash
    ) {
      throw new ApiError("AUTH_REVISION_CONFLICT", 409);
    }
    const currentSession = await tx.authSession.findUnique({
      where: { id: actor.sessionId },
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
  client: Pick<Prisma.TransactionClient, "auditEvent"> = prisma,
): Promise<unknown> {
  return client.auditEvent.create({
    data: { actorId, action, entityType: "AuthSession", entityId: sessionId },
  });
}

async function requireFreshAccountSession(tx: Prisma.TransactionClient, actor: CurrentUser): Promise<void> {
  const now = new Date();
  const session = await requireUsableAccountSession(tx, actor, now, "REAUTHENTICATION_REQUIRED", 403);
  if (!isReauthenticationFresh(
    session.reauthenticatedAt,
    now,
    getAuthEnv().AUTH_REAUTH_MAX_AGE_SECONDS * 1000,
  )) {
    throw new ApiError("REAUTHENTICATION_REQUIRED", 403);
  }
}

async function requireUsableAccountSession(
  tx: Prisma.TransactionClient,
  actor: CurrentUser,
  now: Date,
  errorCode = "UNAUTHORIZED",
  errorStatus = 401,
) {
  // 账户与当前会话按统一顺序加锁，避免改密/撤销/重新验证在检查后竞争提交。
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id = ${actor.sessionId} FOR UPDATE`;
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
  })) throw new ApiError(errorCode, errorStatus);
  return session;
}
