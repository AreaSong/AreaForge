import { createSessionToken, hashIdentifier, hashSessionToken, verifyPassword } from "@areaforge/auth";
import { prisma } from "@areaforge/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkLoginRateLimit, clearLoginFailures, recordLoginFailure } from "@/lib/auth/rate-limit";
import {
  createLoginRateLimitKey,
  getClientIp,
  getSessionExpiresAt,
  normalizeEmail,
  setSessionCookie,
} from "@/lib/auth/session";
import { getAuthEnv } from "@/lib/auth/env";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(256),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  const ip = getClientIp(request);
  const rateLimitKey = createLoginRateLimitKey(ip, email);
  const rateLimit = checkLoginRateLimit(rateLimitKey);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "TOO_MANY_ATTEMPTS", retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true },
  });

  const passwordValid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;

  if (!user || !passwordValid) {
    recordLoginFailure(rateLimitKey);
    await prisma.auditEvent.create({
      data: {
        actorId: user?.id,
        action: "AUTH_LOGIN_FAILED",
        entityType: "User",
        entityId: user?.id,
        metadata: {
          emailHash: hashIdentifier(email),
          ipHash: hashIdentifier(ip),
        },
      },
    });

    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  clearLoginFailures(rateLimitKey);

  const env = getAuthEnv();
  const token = createSessionToken();
  await prisma.authSession.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(token, env.AUTH_SESSION_SECRET),
      expiresAt: getSessionExpiresAt(),
    },
  });

  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "AUTH_LOGIN_SUCCEEDED",
      entityType: "User",
      entityId: user.id,
      metadata: {
        ipHash: hashIdentifier(ip),
      },
    },
  });

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
    },
  });
  setSessionCookie(response, token);
  return response;
}
