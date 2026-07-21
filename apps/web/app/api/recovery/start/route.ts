import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { startRecoveryV2 } from "@/lib/study/recovery-v2-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = bodySchema.safeParse((await readJson(request).catch(() => ({}))) ?? {});
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ recovery: await startRecoveryV2(user.id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
