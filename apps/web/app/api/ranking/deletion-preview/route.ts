import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { previewRankingDeletion } from "@/lib/ranking/deletion-preview-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim() || undefined;
    return NextResponse.json({ preview: await previewRankingDeletion({ userId: actor.id, workspaceId }) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
