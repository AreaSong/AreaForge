import { createSessionToken, deriveDeviceLabel, hashIdentifier, hashSessionToken, isSessionUsable } from "@areaforge/auth";
import { prisma } from "@areaforge/db";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { getSessionCookieOptions, sessionMaxAgeSeconds } from "./cookies";
import { getAuthEnv } from "./env";

export interface CurrentUser {
  id: string;
  email: string;
  sessionId: string;
  status: "ACTIVE" | "SUSPENDED";
  emailVerifiedAt: Date | null;
  reauthenticatedAt: Date | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getClientIp(request: NextRequest): string {
  // 生产入口 Nginx 用 $remote_addr 覆写 X-Real-IP（infra/nginx/*.conf.example），该头可信；
  // X-Forwarded-For 是追加语义（proxy_add_x_forwarded_for），首项可被请求方伪造，只能取最后一跳。
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
  return forwarded?.[forwarded.length - 1] || "local";
}

export function createLoginRateLimitKey(ip: string, email: string): string {
  return hashIdentifier(`login:${hashIdentifier(ip)}:${hashIdentifier(normalizeEmail(email))}`);
}

export function createLoginRateLimitKeys(ip: string, email: string): string[] {
  const normalizedEmail = normalizeEmail(email);
  return [
    createLoginRateLimitKey(ip, normalizedEmail),
    hashIdentifier(`login:ip:${hashIdentifier(ip)}`),
    hashIdentifier(`login:email:${hashIdentifier(normalizedEmail)}`),
  ];
}

export function createPasswordResetRateLimitKey(ip: string, email: string): string {
  return hashIdentifier(`password-reset:${hashIdentifier(ip)}:${hashIdentifier(normalizeEmail(email))}`);
}

export function createPasswordResetRateLimitKeys(ip: string, email: string): string[] {
  const normalizedEmail = normalizeEmail(email);
  return [
    createPasswordResetRateLimitKey(ip, normalizedEmail),
    hashIdentifier(`password-reset:ip:${hashIdentifier(ip)}`),
    hashIdentifier(`password-reset:email:${hashIdentifier(normalizedEmail)}`),
  ];
}

export function createInvitationRateLimitKey(ip: string, email: string): string {
  return hashIdentifier(`invitation:${hashIdentifier(ip)}:${hashIdentifier(normalizeEmail(email))}`);
}

export function createInvitationRateLimitKeys(actorId: string, ip: string, email: string): string[] {
  const normalizedEmail = normalizeEmail(email);
  return [
    createInvitationRateLimitKey(ip, normalizedEmail),
    hashIdentifier(`invitation:actor:${actorId}`),
    hashIdentifier(`invitation:email:${hashIdentifier(normalizedEmail)}`),
  ];
}

export function createSensitiveAuthRateLimitKeys(actor: CurrentUser, ip: string, purpose: string): string[] {
  return [
    hashIdentifier(`${purpose}:session:${actor.sessionId}`),
    hashIdentifier(`${purpose}:account:${actor.id}`),
    hashIdentifier(`${purpose}:ip:${hashIdentifier(ip)}`),
  ];
}

export function getUserAgentHash(request: NextRequest): string | null {
  const userAgent = request.headers.get("user-agent")?.trim();
  return userAgent ? hashIdentifier(userAgent) : null;
}

export function getRequestDeviceLabel(request: NextRequest): string {
  return deriveDeviceLabel(request.headers.get("user-agent"));
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const env = getAuthEnv();
  const cookieStore = await cookies();
  const token = cookieStore.get(env.AUTH_SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  return findUserBySessionToken(token, env.AUTH_SESSION_SECRET);
}

export async function getCurrentUserFromRequest(request: NextRequest): Promise<CurrentUser | null> {
  const env = getAuthEnv();
  const token = request.cookies.get(env.AUTH_SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  return findUserBySessionToken(token, env.AUTH_SESSION_SECRET);
}

export async function deleteCurrentSession(request: NextRequest, reason = "USER_LOGOUT"): Promise<void> {
  const env = getAuthEnv();
  const token = request.cookies.get(env.AUTH_SESSION_COOKIE_NAME)?.value;
  if (!token) return;

  await prisma.authSession.updateMany({
    where: {
      tokenHash: hashSessionToken(token, env.AUTH_SESSION_SECRET),
      revokedAt: null,
    },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export function setSessionCookie(response: NextResponse, token: string): void {
  const env = getAuthEnv();
  response.cookies.set(env.AUTH_SESSION_COOKIE_NAME, token, getSessionCookieOptions());
}

export function clearSessionCookie(response: NextResponse): void {
  const env = getAuthEnv();
  response.cookies.set(env.AUTH_SESSION_COOKIE_NAME, "", {
    ...getSessionCookieOptions(),
    maxAge: 0,
  });
}

export function getSessionExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + sessionMaxAgeSeconds * 1000);
}

export async function createUserSession(
  request: NextRequest,
  user: { id: string; authRevision: number },
): Promise<string> {
  const env = getAuthEnv();
  const token = createSessionToken();
  const ip = getClientIp(request);
  await prisma.authSession.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(token, env.AUTH_SESSION_SECRET),
      authRevision: user.authRevision,
      deviceLabel: getRequestDeviceLabel(request),
      ipHash: hashIdentifier(ip),
      userAgentHash: getUserAgentHash(request),
      reauthenticatedAt: new Date(),
      expiresAt: getSessionExpiresAt(),
    },
  });
  return token;
}

// lastSeenAt 只用于会话活跃度展示，按 5 分钟粒度节流，避免每个请求都产生一次会话写。
const sessionLastSeenWriteIntervalMs = 5 * 60 * 1000;

export async function findUserBySessionToken(token: string, secret: string): Promise<CurrentUser | null> {
  const now = new Date();
  const session = await prisma.authSession.findUnique({
    where: {
      tokenHash: hashSessionToken(token, secret),
    },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      authRevision: true,
      reauthenticatedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          status: true,
          emailVerifiedAt: true,
          authRevision: true,
        },
      },
    },
  });

  if (!session || !isSessionUsable({
    accountStatus: session.user.status,
    accountAuthRevision: session.user.authRevision,
    sessionAuthRevision: session.authRevision,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    now,
  })) return null;

  const lastSeenStale = !session.lastSeenAt
    || now.getTime() - session.lastSeenAt.getTime() >= sessionLastSeenWriteIntervalMs;
  if (lastSeenStale) {
    await prisma.authSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });
  }

  return {
    id: session.user.id,
    email: session.user.email,
    sessionId: session.id,
    status: session.user.status,
    emailVerifiedAt: session.user.emailVerifiedAt,
    reauthenticatedAt: session.reauthenticatedAt,
  };
}
