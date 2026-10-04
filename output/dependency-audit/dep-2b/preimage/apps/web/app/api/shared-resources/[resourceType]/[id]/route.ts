import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { ApiError, apiErrorResponse } from "@/lib/api/responses";
import { getSharedResourceDetail } from "@/lib/workspace/shared-resource-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ resourceType: string; id: string }> },
) {
  try {
    const actor = await requireApiUser(request);
    const { resourceType, id } = await context.params;
    if (resourceType !== "NOTE" && resourceType !== "MISTAKE" && resourceType !== "ATTACHMENT") {
      throw new ApiError("WORKSPACE_RESOURCE_NOT_FOUND", 404);
    }
    return NextResponse.json({ resource: await getSharedResourceDetail(actor.id, resourceType, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
