import { getDummyPasswordHash, hashIdentifier, verifyPassword } from "@areaforge/auth";
import { prisma } from "@areaforge/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { clearAuthFailures, reserveAuthAttempts } from "@/lib/auth/rate-limit";
import {
  createLoginRateLimitKeys,
  createUserSession,
  getClientIp,
  normalizeEmail,
  setSessionCookie,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(256),
});

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const body = await request.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    const email = normalizeEmail(parsed.data.email);
    const ip = getClientIp(request);
    const rateLimitKeys = createLoginRateLimitKeys(ip, email);
    const rateLimit = await reserveAuthAttempts("LOGIN", rateLimitKeys);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "TOO_MANY_ATTEMPTS", retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, status: true, authRevision: true },
    });

    const passwordValid = await verifyPassword(parsed.data.password, user?.passwordHash ?? getDummyPasswordHash());

    if (!user || !passwordValid || user.status !== "ACTIVE") {
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

    await clearAuthFailures("LOGIN", rateLimitKeys);

    const token = await createUserSession(request, user);

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
  } catch (error) {
    return apiErrorResponse(error);
  }
}
