import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { getRankingAppeal, transitionRankingAppeal } from "@/lib/ranking/appeal-service";
import { rankingAppealActionInputSchema } from "@/lib/ranking/contracts";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string; appealId: string }> }) {
  try {
    const actor = await requireApiUser(_request);
    const { id, appealId } = await context.params;
    return NextResponse.json({ appeal: await getRankingAppeal(actor.id, id, appealId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; appealId: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = rankingAppealActionInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id, appealId } = await context.params;
    return NextResponse.json({ appeal: await transitionRankingAppeal(actor, id, appealId, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; appealId: string }> }) {
  return POST(request, context);
}
