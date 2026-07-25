import { NextRequest, NextResponse } from "next/server";
import { isKnowledgeCanvasEntityType } from "@areaforge/core";
import { requireApiUser } from "@/lib/api/auth";
import { ApiError, apiErrorResponse } from "@/lib/api/responses";
import { getKnowledgeCanvas } from "@/lib/study/knowledge-canvas-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const params = request.nextUrl.searchParams;
    const parseInteger = (name: string, fallback: number | null) => {
      const raw = params.get(name);
      if (raw == null || raw === "") return fallback;
      const value = Number(raw);
      if (!Number.isInteger(value)) throw new ApiError(`INVALID_CANVAS_${name.toUpperCase()}`, 400);
      return value;
    };
    const entityType = params.get("entityType");
    if (entityType && !isKnowledgeCanvasEntityType(entityType)) {
      throw new ApiError("INVALID_CANVAS_ENTITY_TYPE", 400);
    }
    const canvas = await getKnowledgeCanvas(user.id, {
      workspaceId: params.get("workspaceId"),
      focus: params.get("focus"),
      depth: parseInteger("depth", 1),
      cursor: params.get("cursor"),
      limit: parseInteger("limit", 80),
      q: params.get("q"),
      subjectId: params.get("subjectId"),
      entityType,
      status: params.get("status"),
    });
    return NextResponse.json({ canvas });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
