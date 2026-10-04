import type { NextRequest } from "next/server";
import { getAuthEnv } from "@/lib/auth/env";
import type { AiProviderPreferenceDto } from "@/lib/contracts/ai";

export type { AiProviderPreferenceDto } from "@/lib/contracts/ai";

export const aiProviderPreferenceMaxAgeSeconds = 60 * 60 * 24 * 180;
const enabledValue = "enabled";
const disabledValue = "disabled";

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

export function getAiProviderPreferenceCookieName(authSessionCookieName?: string): string {
  const sessionCookieName = authSessionCookieName ?? getAuthEnv().AUTH_SESSION_COOKIE_NAME;
  return `${sessionCookieName}_ai_provider_v1`;
}

export function parseAiProviderPreference(value: string | undefined): AiProviderPreferenceDto {
  return {
    externalProviderEnabled: value === enabledValue,
    scope: "current_browser",
  };
}

export function readAiProviderPreference(
  cookies: CookieReader,
  authSessionCookieName?: string,
): AiProviderPreferenceDto {
  return parseAiProviderPreference(
    cookies.get(getAiProviderPreferenceCookieName(authSessionCookieName))?.value,
  );
}

export function readAiProviderPreferenceFromRequest(request: NextRequest): AiProviderPreferenceDto {
  return readAiProviderPreference(request.cookies);
}

export function serializeAiProviderPreference(enabled: boolean): string {
  return enabled ? enabledValue : disabledValue;
}

export function getAiProviderPreferenceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: aiProviderPreferenceMaxAgeSeconds,
  } as const;
}
