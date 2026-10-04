import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { reauthenticateSession } from "@/lib/auth/account-service";
import { clearAuthFailures, reserveAuthAttempts } from "@/lib/auth/rate-limit";
import { createSensitiveAuthRateLimitKeys, getClientIp } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const schema = z.object({ password: z.string().min(1).max(256) });

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const actor = await requireApiUser(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const keyHashes = createSensitiveAuthRateLimitKeys(actor, getClientIp(request), "reauthentication");
    const rateLimit = await reserveAuthAttempts("REAUTHENTICATION", keyHashes);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "TOO_MANY_ATTEMPTS", retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429 },
      );
    }
    const reauthenticatedAt = await reauthenticateSession(actor, parsed.data.password);
    await clearAuthFailures("REAUTHENTICATION", keyHashes);
    return NextResponse.json({ reauthenticatedAt: reauthenticatedAt.toISOString() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
