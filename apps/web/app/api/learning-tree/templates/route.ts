import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, badRequestResponse } from "@/lib/api/responses";
import { getLearningTreeTemplateContent } from "@/lib/study/learning-tree-service";
import type { LearningTreeScope } from "@areaforge/core";

export const dynamic = "force-dynamic";

function parseScope(value: string | null): LearningTreeScope | null {
  if (value === "global" || value === "subject" || value === "branch") return value;
  return null;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    const scope = parseScope(request.nextUrl.searchParams.get("scope"));
    if (!scope) return badRequestResponse("INVALID_SCOPE");
    const template = getLearningTreeTemplateContent(scope);
    return new NextResponse(template.markdown, {
      status: 200,
      headers: {
        "Content-Type": template.contentType,
        "Content-Disposition": `attachment; filename="${template.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
