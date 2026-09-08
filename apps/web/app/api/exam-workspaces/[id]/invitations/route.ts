import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser, requireRecentReauthentication, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createWorkspaceInvitation, listWorkspaceInvitations } from "@/lib/workspace/membership-service";
import { reserveAuthAttempts } from "@/lib/auth/rate-limit";
import { createInvitationRateLimitKeys, getClientIp, normalizeEmail } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
const schema = z.object({ email: z.email() });

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ invitations: await listWorkspaceInvitations(actor.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const actor = await requireApiUser(request);
    await requireRecentReauthentication(actor);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const keyHashes = createInvitationRateLimitKeys(actor.id, getClientIp(request), normalizeEmail(parsed.data.email));
    const rateLimit = await reserveAuthAttempts("INVITATION", keyHashes);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "TOO_MANY_ATTEMPTS", retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429 },
      );
    }
    const { id } = await context.params;
    return NextResponse.json({ invitation: await createWorkspaceInvitation(actor, id, parsed.data.email) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
