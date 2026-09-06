import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { rankingPreferenceInputSchema } from "@/lib/ranking/contracts";
import { getRankingPreference, updateRankingPreference } from "@/lib/ranking/preference-service";

export const dynamic = "force-dynamic";

const patchSchema = rankingPreferenceInputSchema.extend({ workspaceId: z.string().trim().min(1).max(191) }).strict();

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    return NextResponse.json({ preference: await getRankingPreference(actor.id, workspaceId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { workspaceId, ...input } = parsed.data;
    return NextResponse.json({ preference: await updateRankingPreference(actor, workspaceId, input) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
