import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { getChallengeProjection } from "@/lib/ranking/projection-service";
import { requestRankingRebuild, rankingRebuildRequestSchema } from "@/lib/ranking/rebuild-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ projection: await getChallengeProjection(actor.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = rankingRebuildRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id } = await context.params;
    return NextResponse.json({ job: await requestRankingRebuild(actor, id, parsed.data) }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
