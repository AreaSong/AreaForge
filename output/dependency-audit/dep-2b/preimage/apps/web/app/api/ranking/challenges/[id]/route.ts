import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { actionInputSchema, updateChallengeInputSchema } from "@/lib/ranking/contracts";
import { getPrivateChallenge, transitionPrivateChallenge, updatePrivateChallenge } from "@/lib/ranking/challenge-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ challenge: await getPrivateChallenge(actor.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = updateChallengeInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id } = await context.params;
    return NextResponse.json({ challenge: await updatePrivateChallenge(actor, id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = actionInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id } = await context.params;
    return NextResponse.json({ challenge: await transitionPrivateChallenge(actor, id, "dissolve", parsed.data.expectedRevision) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
