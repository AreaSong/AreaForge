import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getStageAdjustmentDraft } from "@/lib/study/stage-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ draft: await getStageAdjustmentDraft(id, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
