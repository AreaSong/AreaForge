import { prisma, type Prisma } from "@areaforge/db";
import { requireFreshAccountSession } from "@/lib/auth/account-service";
import { requireRbacFeature } from "@/lib/auth/feature-gates";
import { getAuthEnv } from "@/lib/auth/env";
import type { CurrentUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/responses";
import type { OperatorAccountDto, OperatorAccountReasonCode } from "@/lib/contracts/operator-account";
import { isPlatformOperatorEmail, requirePlatformOperator } from "./operator-policy";

export const OPERATOR_ACCOUNT_REASON_CODES = [
  "SECURITY_REVIEW",
  "USER_REQUEST",
  "ABUSE_PREVENTION",
  "INCIDENT_RESPONSE",
] as const;
export type { OperatorAccountDto, OperatorAccountReasonCode } from "@/lib/contracts/operator-account";

export async function listOperatorAccounts(actor: CurrentUser): Promise<OperatorAccountDto[]> {
  requireRbacFeature();
  await requirePlatformOperator(actor);
  const now = new Date();
  const accounts = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      status: true,
      emailVerifiedAt: true,
      authRevision: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          workspaceMemberships: { where: { status: "ACTIVE" } },
          sessions: { where: { revokedAt: null, expiresAt: { gt: now } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return accounts.map((account) => ({
    id: account.id,
    maskedEmail: maskEmail(account.email),
    status: account.status,
    emailVerified: Boolean(account.emailVerifiedAt),
    authRevision: account.authRevision,
    activeMembershipCount: account._count.workspaceMemberships,
    activeSessionCount: account._count.sessions,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  }));
}

export async function updateOperatorAccountStatus(
  actor: CurrentUser,
  targetUserId: string,
  input: {
    status: "ACTIVE" | "SUSPENDED";
    expectedAuthRevision: number;
    reason: OperatorAccountReasonCode;
  },
): Promise<OperatorAccountDto> {
  requireRbacFeature();
  if (targetUserId === actor.id) throw new ApiError("OPERATOR_SELF_ACTION_FORBIDDEN", 409);
  return prisma.$transaction(async (tx) => {
    await requireFreshAccountSession(tx, actor);
    requireConfiguredOperator(actor);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${targetUserId} FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw accountNotFound();
    if (target.authRevision !== input.expectedAuthRevision) throw new ApiError("AUTH_REVISION_CONFLICT", 409);
    if (target.status === input.status) return loadOperatorAccount(tx, target.id);

    const updated = await tx.user.update({
      where: { id: target.id },
      data: { status: input.status, authRevision: { increment: 1 } },
    });
    let revokedSessionCount = 0;
    if (input.status === "SUSPENDED") {
      const revoked = await tx.authSession.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "PLATFORM_OPERATOR_SUSPENDED_ACCOUNT" },
      });
      revokedSessionCount = revoked.count;
    }
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "PLATFORM_ACCOUNT_STATUS_CHANGED",
        entityType: "User",
        entityId: target.id,
        metadata: {
          fromStatus: target.status,
          toStatus: updated.status,
          reason: input.reason,
          authRevision: updated.authRevision,
          revokedSessionCount,
        },
      },
    });
    return loadOperatorAccount(tx, updated.id);
  }, { isolationLevel: "Serializable" });
}

export async function revokeOperatorTargetSessions(
  actor: CurrentUser,
  targetUserId: string,
  reason: OperatorAccountReasonCode,
): Promise<{ revokedSessionCount: number }> {
  requireRbacFeature();
  if (targetUserId === actor.id) throw new ApiError("OPERATOR_SELF_ACTION_FORBIDDEN", 409);
  return prisma.$transaction(async (tx) => {
    await requireFreshAccountSession(tx, actor);
    requireConfiguredOperator(actor);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${targetUserId} FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!target) throw accountNotFound();
    const revoked = await tx.authSession.updateMany({
      where: { userId: target.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date(), revokedReason: "PLATFORM_OPERATOR_REVOKED_SESSIONS" },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "PLATFORM_ACCOUNT_SESSIONS_REVOKED",
        entityType: "User",
        entityId: target.id,
        metadata: { reason, revokedSessionCount: revoked.count },
      },
    });
    return { revokedSessionCount: revoked.count };
  }, { isolationLevel: "Serializable" });
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const safeLocal = local.length <= 2 ? `${local.slice(0, 1)}*` : `${local.slice(0, 2)}${"*".repeat(Math.min(6, local.length - 2))}`;
  const domainParts = domain.split(".");
  const domainName = domainParts.shift() ?? "";
  const safeDomain = `${domainName.slice(0, 1)}${domainName.length > 1 ? "***" : "*"}`;
  return `${safeLocal}@${safeDomain}${domainParts.length ? `.${domainParts.join(".")}` : ""}`;
}

function requireConfiguredOperator(actor: CurrentUser): void {
  if (!isPlatformOperatorEmail(actor.email, getAuthEnv().AUTH_ADMIN_EMAIL)) throw accountNotFound();
}

async function loadOperatorAccount(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<OperatorAccountDto> {
  const now = new Date();
  const account = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      status: true,
      emailVerifiedAt: true,
      authRevision: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          workspaceMemberships: { where: { status: "ACTIVE" } },
          sessions: { where: { revokedAt: null, expiresAt: { gt: now } } },
        },
      },
    },
  });
  if (!account) throw accountNotFound();
  return {
    id: account.id,
    maskedEmail: maskEmail(account.email),
    status: account.status,
    emailVerified: Boolean(account.emailVerifiedAt),
    authRevision: account.authRevision,
    activeMembershipCount: account._count.workspaceMemberships,
    activeSessionCount: account._count.sessions,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

function accountNotFound(): ApiError {
  return new ApiError("PLATFORM_ACCOUNT_NOT_FOUND", 404);
}
