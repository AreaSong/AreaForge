import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { changeAccountPassword } from "@/lib/auth/account-service";
import { clearAuthFailures, reserveAuthAttempts } from "@/lib/auth/rate-limit";
import { createSensitiveAuthRateLimitKeys, getClientIp, setSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().min(1).max(256),
  nextPassword: z.string().min(12).max(256),
});

export async function PATCH(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const actor = await requireApiUser(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const keyHashes = createSensitiveAuthRateLimitKeys(actor, getClientIp(request), "password-change");
    const rateLimit = await reserveAuthAttempts("PASSWORD_CHANGE", keyHashes);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "TOO_MANY_ATTEMPTS", retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429 },
      );
    }
    const token = await changeAccountPassword(actor, parsed.data.currentPassword, parsed.data.nextPassword);
    await clearAuthFailures("PASSWORD_CHANGE", keyHashes);
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
