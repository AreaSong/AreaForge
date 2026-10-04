import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getPlatformCapacitySnapshot } from "@/lib/system/platform-capacity-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    return NextResponse.json({ capacity: await getPlatformCapacitySnapshot(actor, workspaceId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
