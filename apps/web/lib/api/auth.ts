import type { NextRequest } from "next/server";
import { isReauthenticationFresh, isSessionUsable } from "@areaforge/auth";
import { prisma } from "@areaforge/db";
import { getCurrentUserFromRequest, type CurrentUser } from "@/lib/auth/session";
import { getAuthEnv } from "@/lib/auth/env";
import { ApiError } from "./responses";

export async function requireApiUser(request: NextRequest): Promise<CurrentUser> {
  // Every authenticated mutation is browser-bound. Keeping this check at the
  // shared authentication boundary prevents a newly added route from
  // accidentally omitting CSRF protection; explicit route checks may remain
  // for sensitive endpoints and are idempotent.
  if (!isSafeReadMethod(request.method)) requireSameOrigin(request);
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    throw new ApiError("UNAUTHORIZED", 401);
  }

  return user;
}

function isSafeReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export async function readJson(request: NextRequest): Promise<unknown> {
  return request.json().catch(() => null);
}

export function requireSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!isAllowedRequestOrigin(origin, getAuthEnv().APP_URL)) {
    throw new ApiError("INVALID_REQUEST_ORIGIN", 403);
  }
}

export function isAllowedRequestOrigin(origin: string | null, appUrl: string): boolean {
  if (!origin) return false;
  try {
    const parsedOrigin = new URL(origin);
    return origin === parsedOrigin.origin && parsedOrigin.origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

export async function requireRecentReauthentication(user: CurrentUser): Promise<void> {
  const now = new Date();
  const maxAgeMs = getAuthEnv().AUTH_REAUTH_MAX_AGE_SECONDS * 1000;
  const session = await prisma.authSession.findFirst({
    where: { id: user.sessionId, userId: user.id },
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
  }) || !isReauthenticationFresh(session.reauthenticatedAt, now, maxAgeMs)) {
    throw new ApiError("REAUTHENTICATION_REQUIRED", 403);
  }
}
