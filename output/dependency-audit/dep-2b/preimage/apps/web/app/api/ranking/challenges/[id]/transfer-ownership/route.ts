import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { transferOwnershipInputSchema } from "@/lib/ranking/contracts";
import { transferPrivateChallengeOwnership } from "@/lib/ranking/challenge-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = transferOwnershipInputSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id } = await context.params;
    return NextResponse.json({ challenge: await transferPrivateChallengeOwnership(actor, id, parsed.data.targetParticipantId, parsed.data.expectedRevision) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
