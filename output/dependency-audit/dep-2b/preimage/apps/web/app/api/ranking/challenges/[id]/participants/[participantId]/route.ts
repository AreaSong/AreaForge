import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { removePrivateChallengeParticipant, updatePrivateChallengeParticipant } from "@/lib/ranking/challenge-service";
import { participantUpdateInputSchema } from "@/lib/ranking/contracts";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; participantId: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = participantUpdateInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id, participantId } = await context.params;
    return NextResponse.json({ participant: await updatePrivateChallengeParticipant(actor, id, participantId, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; participantId: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const { id, participantId } = await context.params;
    return NextResponse.json({ participant: await removePrivateChallengeParticipant(actor, id, participantId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
