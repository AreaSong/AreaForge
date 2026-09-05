import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { requestEmailVerification } from "@/lib/auth/action-token-service";
import { reserveAuthAttempts } from "@/lib/auth/rate-limit";
import { createSensitiveAuthRateLimitKeys, getClientIp } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const actor = await requireApiUser(request);
    const keyHashes = createSensitiveAuthRateLimitKeys(actor, getClientIp(request), "email-verification");
    const rateLimit = await reserveAuthAttempts("EMAIL_VERIFICATION", keyHashes);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "TOO_MANY_ATTEMPTS", retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429 },
      );
    }
    await requestEmailVerification(actor);
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
