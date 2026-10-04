import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { getKnowledgePoint, updateKnowledgePoint } from "@/lib/study/knowledge-point-service";
import { updateKnowledgePointSchema } from "@/lib/study/schemas";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(_request);
    const { id } = await context.params;
    const knowledgePoint = await getKnowledgePoint(user.id, id);
    if (!knowledgePoint) return NextResponse.json({ error: "KNOWLEDGE_POINT_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ knowledgePoint });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = updateKnowledgePointSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ knowledgePoint: await updateKnowledgePoint(user.id, id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
