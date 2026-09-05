import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { listWorkspaceMembers } from "@/lib/workspace/membership-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ members: await listWorkspaceMembers(actor.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
