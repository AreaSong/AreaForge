import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { transitionPrivateChallengeParticipantForActor } from "@/lib/ranking/challenge-service";
import { actionInputSchema } from "@/lib/ranking/contracts";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const schema = actionInputSchema.extend({ action: z.enum(["join", "leave"]) }).strict();
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id } = await context.params;
    return NextResponse.json({ participant: await transitionPrivateChallengeParticipantForActor(actor, id, parsed.data.action) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
