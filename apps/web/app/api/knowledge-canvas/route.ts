import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getKnowledgeCanvas } from "@/lib/study/knowledge-canvas-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const params = request.nextUrl.searchParams;
    const canvas = await getKnowledgeCanvas(user.id, {
      workspaceId: params.get("workspaceId"),
      focus: params.get("focus"),
      depth: params.get("depth") ? Number(params.get("depth")) : 1,
      cursor: params.get("cursor"),
      limit: params.get("limit") ? Number(params.get("limit")) : 80,
      q: params.get("q"),
      subjectId: params.get("subjectId"),
      entityType: params.get("entityType"),
    });
    return NextResponse.json({ canvas });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
