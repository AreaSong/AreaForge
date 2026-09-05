import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { listDeviceSessions } from "@/lib/auth/account-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    return NextResponse.json({ sessions: await listDeviceSessions(actor) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
