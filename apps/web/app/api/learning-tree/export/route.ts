import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, badRequestResponse } from "@/lib/api/responses";
import { consumeLearningTreeExport, previewActiveLearningTreeExport } from "@/lib/study/learning-tree-service";
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
    if (request.nextUrl.searchParams.get("preview") === "1") {
      return NextResponse.json({
        preview: await previewActiveLearningTreeExport(user.id, scope, { subjectKey, rootNodeKey }),
      });
    }
    return badRequestResponse("LEARNING_TREE_EXPORT_CONFIRMATION_REQUIRED");
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = (await request.json()) as Record<string, unknown>;
    const scope = parseScope(typeof body.scope === "string" ? body.scope : null);
    if (!scope || typeof body.exportToken !== "string" || !body.exportToken) {
      return badRequestResponse("INVALID_EXPORT_REQUEST");
    }
    const subjectKey = typeof body.subjectKey === "string" && body.subjectKey ? body.subjectKey : undefined;
    const rootNodeKey = typeof body.rootNodeKey === "string" && body.rootNodeKey ? body.rootNodeKey : undefined;
    const exported = await consumeLearningTreeExport(user.id, {
      token: body.exportToken,
      scope,
      subjectKey,
      rootNodeKey,
    });
    return new NextResponse(exported.markdown, {
      status: 200,
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
