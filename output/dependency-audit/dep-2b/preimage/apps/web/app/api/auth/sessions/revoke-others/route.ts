import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, requireRecentReauthentication, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { revokeOtherDeviceSessions } from "@/lib/auth/account-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const actor = await requireApiUser(request);
    await requireRecentReauthentication(actor);
    return NextResponse.json({ revokedSessionCount: await revokeOtherDeviceSessions(actor) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
