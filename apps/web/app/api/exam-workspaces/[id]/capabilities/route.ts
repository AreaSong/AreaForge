import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getWorkspaceCapabilities } from "@/lib/workspace/rbac-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ capability: await getWorkspaceCapabilities(actor.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
