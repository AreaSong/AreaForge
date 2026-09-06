import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { actionInputSchema } from "@/lib/ranking/contracts";
import { transitionPrivateChallenge } from "@/lib/ranking/challenge-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
