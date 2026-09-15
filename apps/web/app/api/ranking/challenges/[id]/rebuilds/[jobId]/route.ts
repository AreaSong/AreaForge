import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { changeRankingRebuild, rankingRebuildControlSchema } from "@/lib/ranking/rebuild-service";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; jobId: string }> }) {
  try {
    const actor = await requireApiUser(request); const { id, jobId } = await context.params;
    const parsed = rankingRebuildControlSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ job: await changeRankingRebuild(actor, id, jobId, parsed.data) });
  } catch (error) { return apiErrorResponse(error); }
}
