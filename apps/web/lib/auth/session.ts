import { hashIdentifier, hashSessionToken } from "@areaforge/auth";
import { prisma } from "@areaforge/db";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { getSessionCookieOptions, sessionMaxAgeSeconds } from "./cookies";
import { getAuthEnv } from "./env";

export interface CurrentUser {
  id: string;
  email: string;
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
  return `${ip}:${hashIdentifier(normalizeEmail(email))}`;
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

export async function deleteCurrentSession(request: NextRequest): Promise<void> {
  const env = getAuthEnv();
  const token = request.cookies.get(env.AUTH_SESSION_COOKIE_NAME)?.value;
  if (!token) return;

  await prisma.authSession.deleteMany({
    where: {
      tokenHash: hashSessionToken(token, env.AUTH_SESSION_SECRET),
    },
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

// lastSeenAt 只用于会话活跃度展示，按 5 分钟粒度节流，避免每个请求都产生一次会话写。
const sessionLastSeenWriteIntervalMs = 5 * 60 * 1000;

async function findUserBySessionToken(token: string, secret: string): Promise<CurrentUser | null> {
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
      user: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= now) return null;

  const lastSeenStale = !session.lastSeenAt
    || now.getTime() - session.lastSeenAt.getTime() >= sessionLastSeenWriteIntervalMs;
  if (lastSeenStale) {
    await prisma.authSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });
  }

  return session.user;
}
