import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, requireRecentReauthentication, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { revokeDeviceSession } from "@/lib/auth/account-service";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const actor = await requireApiUser(request);
    await requireRecentReauthentication(actor);
    const { id } = await context.params;
    await revokeDeviceSession(actor, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
