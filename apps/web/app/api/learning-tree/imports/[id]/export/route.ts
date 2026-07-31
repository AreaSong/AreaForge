import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { exportLearningTreeImportCanonical } from "@/lib/study/learning-tree-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const exported = await exportLearningTreeImportCanonical(user.id, id);
    return new NextResponse(exported.markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "Cache-Control": "private, no-store",
        "X-AreaForge-Workspace-Id": exported.workspaceId,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
