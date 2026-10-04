import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { stageAdjustmentDraftSchema } from "@/lib/study/schemas";
import { createStageAdjustmentDraft, listStageAdjustmentDrafts } from "@/lib/study/stage-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ drafts: await listStageAdjustmentDrafts(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = stageAdjustmentDraftSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({ draft: await createStageAdjustmentDraft(parsed.data, user.id) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
