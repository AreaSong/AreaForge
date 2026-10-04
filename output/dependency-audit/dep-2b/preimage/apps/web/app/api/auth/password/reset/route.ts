import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { resetPasswordWithToken } from "@/lib/auth/action-token-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(32).max(256),
  nextPassword: z.string().min(12).max(256),
});

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    await resetPasswordWithToken(parsed.data.token, parsed.data.nextPassword);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
