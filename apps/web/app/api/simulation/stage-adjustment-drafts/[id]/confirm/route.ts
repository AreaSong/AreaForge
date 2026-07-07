import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { confirmStageAdjustmentDraft } from "@/lib/study/stage-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ draft: await confirmStageAdjustmentDraft(id, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
