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
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
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
      user: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= now) return null;

  await prisma.authSession.update({
    where: { id: session.id },
    data: { lastSeenAt: now },
  });

  return session.user;
}
