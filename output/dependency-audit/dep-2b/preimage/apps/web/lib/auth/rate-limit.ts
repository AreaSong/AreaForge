import { prisma, type Prisma } from "@areaforge/db";

const loginPolicy = {
  windowMs: 15 * 60 * 1000,
  lockMs: 10 * 60 * 1000,
  maxAttempts: 5,
} as const;

type AuthThrottlePurpose = "LOGIN" | "INVITATION" | "EMAIL_VERIFICATION" | "PASSWORD_RESET" | "REAUTHENTICATION" | "PASSWORD_CHANGE";

export interface AuthRateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export async function checkAuthRateLimit(
  purpose: AuthThrottlePurpose,
  keyHash: string,
  now = new Date(),
): Promise<AuthRateLimitResult> {
  const state = await prisma.authThrottleBucket.findUnique({
    where: { purpose_keyHash: { purpose, keyHash } },
    select: { lockedUntil: true },
  });
  if (!state?.lockedUntil || state.lockedUntil <= now) return { allowed: true };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 1000)),
  };
}

export async function recordAuthFailure(
  purpose: AuthThrottlePurpose,
  keyHash: string,
  now = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockThrottleBucket(tx, purpose, keyHash);
    const existing = await tx.authThrottleBucket.findUnique({
      where: { purpose_keyHash: { purpose, keyHash } },
    });
    const windowExpired = !existing || existing.windowExpiresAt <= now;
    const failureCount = windowExpired ? 1 : existing.failureCount + 1;
    const lockedUntil = failureCount >= loginPolicy.maxAttempts
      ? new Date(now.getTime() + loginPolicy.lockMs)
      : null;
    const windowStartedAt = windowExpired ? now : existing.windowStartedAt;
    const windowExpiresAt = windowExpired
      ? new Date(now.getTime() + loginPolicy.windowMs)
      : existing.windowExpiresAt;

    await tx.authThrottleBucket.upsert({
      where: { purpose_keyHash: { purpose, keyHash } },
      create: {
        purpose,
        keyHash,
        windowStartedAt,
        windowExpiresAt,
        failureCount,
        lockedUntil,
        lastFailedAt: now,
      },
      update: {
        windowStartedAt,
        windowExpiresAt,
        failureCount,
        lockedUntil,
        lastFailedAt: now,
      },
    });
  });
}

export async function reserveAuthAttempts(
  purpose: AuthThrottlePurpose,
  keyHashes: string[],
  now = new Date(),
): Promise<AuthRateLimitResult> {
  const keys = Array.from(new Set(keyHashes)).sort();
  if (keys.length === 0) throw new Error("至少需要一个认证限流键");
  return prisma.$transaction(async (tx) => {
    for (const keyHash of keys) await lockThrottleBucket(tx, purpose, keyHash);
    const states = await tx.authThrottleBucket.findMany({
      where: { purpose, keyHash: { in: keys } },
    });
    const locked = states
      .filter((state) => state.lockedUntil && state.lockedUntil > now)
      .sort((left, right) => (right.lockedUntil?.getTime() ?? 0) - (left.lockedUntil?.getTime() ?? 0))[0];
    if (locked?.lockedUntil) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((locked.lockedUntil.getTime() - now.getTime()) / 1000)),
      };
    }
    const stateByKey = new Map(states.map((state) => [state.keyHash, state]));
    for (const keyHash of keys) {
      const existing = stateByKey.get(keyHash);
      const windowExpired = !existing || existing.windowExpiresAt <= now;
      const failureCount = windowExpired ? 1 : existing.failureCount + 1;
      const windowStartedAt = windowExpired ? now : existing.windowStartedAt;
      const windowExpiresAt = windowExpired
        ? new Date(now.getTime() + loginPolicy.windowMs)
        : existing.windowExpiresAt;
      await tx.authThrottleBucket.upsert({
        where: { purpose_keyHash: { purpose, keyHash } },
        create: {
          purpose,
          keyHash,
          windowStartedAt,
          windowExpiresAt,
          failureCount,
          lockedUntil: failureCount >= loginPolicy.maxAttempts ? new Date(now.getTime() + loginPolicy.lockMs) : null,
          lastFailedAt: now,
        },
        update: {
          windowStartedAt,
          windowExpiresAt,
          failureCount,
          lockedUntil: failureCount >= loginPolicy.maxAttempts ? new Date(now.getTime() + loginPolicy.lockMs) : null,
          lastFailedAt: now,
        },
      });
    }
    return { allowed: true };
  });
}

export async function clearAuthFailures(
  purpose: AuthThrottlePurpose,
  keyHash: string | string[],
): Promise<void> {
  const keys = Array.from(new Set(Array.isArray(keyHash) ? keyHash : [keyHash])).sort();
  if (keys.length === 0) return;
  await prisma.$transaction(async (tx) => {
    for (const key of keys) await lockThrottleBucket(tx, purpose, key);
    await tx.authThrottleBucket.deleteMany({ where: { purpose, keyHash: { in: keys } } });
  });
}

export function checkLoginRateLimit(keyHash: string, now = new Date()): Promise<AuthRateLimitResult> {
  return checkAuthRateLimit("LOGIN", keyHash, now);
}

export function recordLoginFailure(keyHash: string, now = new Date()): Promise<void> {
  return recordAuthFailure("LOGIN", keyHash, now);
}

export function clearLoginFailures(keyHash: string): Promise<void> {
  return clearAuthFailures("LOGIN", keyHash);
}

async function lockThrottleBucket(
  tx: Prisma.TransactionClient,
  purpose: AuthThrottlePurpose,
  keyHash: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${purpose}:${keyHash}`}))`;
}
