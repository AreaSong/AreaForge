import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { restartRecoveryV2 } from "@/lib/study/recovery-v2-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  expectedRevision: z.number().int().positive(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      recovery: await restartRecoveryV2(user.id, id, parsed.data),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
