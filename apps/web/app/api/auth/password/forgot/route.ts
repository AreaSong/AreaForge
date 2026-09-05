import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { deliverPasswordReset, preparePasswordReset } from "@/lib/auth/action-token-service";
import { reserveAuthAttempts } from "@/lib/auth/rate-limit";
import { enforcePasswordResetResponseTiming } from "@/lib/auth/response-timing";
import { createPasswordResetRateLimitKeys, getClientIp, normalizeEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.email() });

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const email = normalizeEmail(parsed.data.email);
    const startedAtMs = Date.now();
    try {
      const keyHashes = createPasswordResetRateLimitKeys(getClientIp(request), email);
      const rateLimit = await reserveAuthAttempts("PASSWORD_RESET", keyHashes);
      if (rateLimit.allowed) {
        const delivery = await preparePasswordReset(email);
        if (delivery) after(() => deliverPasswordReset(delivery));
      }
    } finally {
      await enforcePasswordResetResponseTiming(startedAtMs);
    }
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
