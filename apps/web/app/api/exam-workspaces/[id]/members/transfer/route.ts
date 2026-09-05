import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser, requireRecentReauthentication, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { transferWorkspaceOwnership } from "@/lib/workspace/membership-service";

export const dynamic = "force-dynamic";
const schema = z.object({
  targetMembershipId: z.string().min(1),
  expectedOwnerRevision: z.number().int().positive(),
  expectedTargetRevision: z.number().int().positive(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const actor = await requireApiUser(request);
    await requireRecentReauthentication(actor);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id } = await context.params;
    await transferWorkspaceOwnership(
      actor,
      id,
      parsed.data.targetMembershipId,
      parsed.data.expectedOwnerRevision,
      parsed.data.expectedTargetRevision,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
