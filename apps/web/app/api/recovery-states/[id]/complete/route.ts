import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { finishRecoveryStateSchema } from "@/lib/study/schemas";
import { completeRecoveryState } from "@/lib/study/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser(request);
    const { id } = await context.params;
    const parsed = finishRecoveryStateSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({ recoveryState: await completeRecoveryState(id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
