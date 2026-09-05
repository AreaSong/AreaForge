import {
  createAuthActionToken,
  hashAuthActionToken,
  hashIdentifier,
  hashPassword,
  isAuthActionTokenUsable,
  isPasswordPolicySatisfied,
} from "@areaforge/auth";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAuthEnv } from "./env";
import { sendAuthMail } from "./mail";
import { normalizeEmail, type CurrentUser } from "./session";

type ActionPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export interface PasswordResetDelivery {
  userId: string;
  tokenId: string;
  email: string;
  actionUrl: string;
}

export async function preparePasswordReset(emailInput: string): Promise<PasswordResetDelivery | null> {
  const email = normalizeEmail(emailInput);
  const account = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, status: true },
  });
  if (!account || account.status !== "ACTIVE") {
    await recordUnknownResetRequest(email);
    return null;
  }

  const issued = await rotateActionToken(account.id, "PASSWORD_RESET");
  return {
    userId: account.id,
    tokenId: issued.id,
    email: account.email,
    actionUrl: authActionUrl("/reset-password", issued.token),
  };
}

export async function deliverPasswordReset(delivery: PasswordResetDelivery): Promise<void> {
  try {
    await sendAuthMail({ to: delivery.email, purpose: "PASSWORD_RESET", actionUrl: delivery.actionUrl });
    await recordTokenAudit(delivery.userId, delivery.tokenId, "AUTH_PASSWORD_RESET_REQUESTED");
  } catch {
    await revokeIssuedToken(delivery.userId, delivery.tokenId, "AUTH_PASSWORD_RESET_DELIVERY_FAILED");
  }
}

export async function resetPasswordWithToken(token: string, nextPassword: string): Promise<void> {
  if (!isPasswordPolicySatisfied(nextPassword)) {
    throw new ApiError("PASSWORD_POLICY_NOT_SATISFIED", 400);
  }
  const tokenHash = hashAuthActionToken(token, "PASSWORD_RESET", actionTokenSecret());
  const record = await prisma.authActionToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { status: true, authRevision: true, passwordHash: true } } },
  });
  if (!record || record.user.status !== "ACTIVE" || !isUsableRecord(record, "PASSWORD_RESET")) {
    throw new ApiError("AUTH_ACTION_TOKEN_INVALID", 400);
  }
  const passwordHash = await hashPassword(nextPassword);
  await consumePasswordReset(record, passwordHash);
}

export async function requestEmailVerification(actor: CurrentUser): Promise<void> {
  if (actor.emailVerifiedAt) return;
  const issued = await rotateActionToken(actor.id, "EMAIL_VERIFICATION");
  const actionUrl = authActionUrl("/verify-email", issued.token);
  try {
    await sendAuthMail({ to: actor.email, purpose: "EMAIL_VERIFICATION", actionUrl });
    await recordTokenAudit(actor.id, issued.id, "AUTH_EMAIL_VERIFICATION_REQUESTED");
  } catch {
    await revokeIssuedToken(actor.id, issued.id, "AUTH_EMAIL_VERIFICATION_DELIVERY_FAILED");
    throw new ApiError("AUTH_MAIL_DELIVERY_FAILED", 503);
  }
}

export async function verifyEmailWithToken(token: string): Promise<void> {
  const tokenHash = hashAuthActionToken(token, "EMAIL_VERIFICATION", actionTokenSecret());
  const record = await prisma.authActionToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { status: true } } },
  });
  if (!record || record.user.status !== "ACTIVE" || !isUsableRecord(record, "EMAIL_VERIFICATION")) {
    throw new ApiError("AUTH_ACTION_TOKEN_INVALID", 400);
  }
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const consumed = await tx.authActionToken.updateMany({
      where: { id: record.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw new ApiError("AUTH_ACTION_TOKEN_INVALID", 400);
    await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } });
    await tx.auditEvent.create({
      data: {
        actorId: record.userId,
        action: "AUTH_EMAIL_VERIFIED",
        entityType: "AuthActionToken",
        entityId: record.id,
      },
    });
  });
}

async function rotateActionToken(userId: string, purpose: ActionPurpose) {
  const env = getAuthEnv();
  const token = createAuthActionToken();
  const tokenHash = hashAuthActionToken(token, purpose, actionTokenSecret());
  const ttlSeconds = purpose === "PASSWORD_RESET"
    ? env.AUTH_PASSWORD_RESET_TTL_SECONDS
    : env.AUTH_EMAIL_VERIFICATION_TTL_SECONDS;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-action:${userId}:${purpose}`}))`;
    const now = new Date();
    await tx.authActionToken.updateMany({
      where: { userId, purpose, consumedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const record = await tx.authActionToken.create({
      data: { userId, purpose, tokenHash, expiresAt: new Date(now.getTime() + ttlSeconds * 1000) },
      select: { id: true },
    });
    return { ...record, token };
  });
}

async function consumePasswordReset(
  record: { id: string; userId: string; user: { authRevision: number } },
  passwordHash: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const consumed = await tx.authActionToken.updateMany({
      where: { id: record.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw new ApiError("AUTH_ACTION_TOKEN_INVALID", 400);
    const changed = await tx.user.updateMany({
      where: { id: record.userId, status: "ACTIVE", authRevision: record.user.authRevision },
      data: { passwordHash, passwordChangedAt: now, authRevision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new ApiError("AUTH_ACTION_TOKEN_INVALID", 400);
    await tx.authSession.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: "PASSWORD_RESET" },
    });
    await tx.auditEvent.create({
      data: {
        actorId: record.userId,
        action: "AUTH_PASSWORD_RESET_COMPLETED",
        entityType: "AuthActionToken",
        entityId: record.id,
        metadata: { authRevision: record.user.authRevision + 1 },
      },
    });
  });
}

function isUsableRecord(
  record: {
    purpose: ActionPurpose;
    expiresAt: Date;
    consumedAt: Date | null;
    revokedAt: Date | null;
  },
  expectedPurpose: ActionPurpose,
): boolean {
  return isAuthActionTokenUsable({ ...record, expectedPurpose });
}

function actionTokenSecret(): string {
  const secret = getAuthEnv().AUTH_ACTION_TOKEN_SECRET;
  if (!secret) throw new ApiError("AUTH_ACTION_TOKEN_NOT_CONFIGURED", 503);
  return secret;
}

function authActionUrl(path: string, token: string): string {
  const url = new URL(path, getAuthEnv().APP_URL);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

async function revokeIssuedToken(userId: string, tokenId: string, action: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.authActionToken.updateMany({ where: { id: tokenId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditEvent.create({ data: { actorId: userId, action, entityType: "AuthActionToken", entityId: tokenId } });
  });
}

function recordTokenAudit(userId: string, tokenId: string, action: string): Promise<unknown> {
  return prisma.auditEvent.create({ data: { actorId: userId, action, entityType: "AuthActionToken", entityId: tokenId } });
}

function recordUnknownResetRequest(email: string): Promise<unknown> {
  return prisma.auditEvent.create({
    data: {
      action: "AUTH_PASSWORD_RESET_REQUESTED_UNKNOWN",
      entityType: "User",
      metadata: { emailHash: hashIdentifier(email) } as Prisma.InputJsonValue,
    },
  });
}
