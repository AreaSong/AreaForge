import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser, requireRecentReauthentication, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { removeWorkspaceMember } from "@/lib/workspace/membership-service";

export const dynamic = "force-dynamic";
const schema = z.object({ expectedRevision: z.number().int().positive() });

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; membershipId: string }> },
) {
  try {
    requireSameOrigin(request);
    const actor = await requireApiUser(request);
    await requireRecentReauthentication(actor);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id, membershipId } = await context.params;
    await removeWorkspaceMember(actor, id, membershipId, parsed.data.expectedRevision);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
