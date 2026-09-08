import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { listSharedWithActor } from "@/lib/workspace/share-grant-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    return NextResponse.json({ sharedResources: await listSharedWithActor(actor.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
