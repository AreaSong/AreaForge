import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { getPrivateChallenge, invitePrivateChallengeParticipant } from "@/lib/ranking/challenge-service";
import { participantInviteInputSchema } from "@/lib/ranking/contracts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const { id } = await context.params;
    const challenge = await getPrivateChallenge(actor.id, id);
    return NextResponse.json({ participants: challenge.participants ?? [] });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = participantInviteInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id } = await context.params;
    return NextResponse.json({ participant: await invitePrivateChallengeParticipant(actor, id, parsed.data) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
