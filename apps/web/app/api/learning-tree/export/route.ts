import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, badRequestResponse } from "@/lib/api/responses";
import { exportActiveLearningTreeMarkdown } from "@/lib/study/learning-tree-service";
import type { LearningTreeScope } from "@areaforge/core";

export const dynamic = "force-dynamic";

function parseScope(value: string | null): LearningTreeScope | null {
  if (value === "global" || value === "subject" || value === "branch") return value;
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const scope = parseScope(request.nextUrl.searchParams.get("scope"));
    if (!scope) return badRequestResponse("INVALID_SCOPE");
    const subjectKey = request.nextUrl.searchParams.get("subjectKey") ?? undefined;
    const rootNodeKey = request.nextUrl.searchParams.get("rootNodeKey") ?? undefined;
    const exported = await exportActiveLearningTreeMarkdown(user.id, scope, {
      subjectKey,
      rootNodeKey,
    });
    return new NextResponse(exported.markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "Cache-Control": "no-store",
        "X-AreaForge-Workspace-Id": exported.workspaceId,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
