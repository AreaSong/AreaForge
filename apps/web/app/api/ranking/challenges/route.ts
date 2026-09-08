import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createChallengeInputSchema } from "@/lib/ranking/contracts";
import { createPrivateChallenge, listPrivateChallenges } from "@/lib/ranking/challenge-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    return NextResponse.json({ challenges: await listPrivateChallenges(actor.id, request.nextUrl.searchParams.get("workspaceId") ?? undefined) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const parsed = createChallengeInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ challenge: await createPrivateChallenge(actor, parsed.data) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
