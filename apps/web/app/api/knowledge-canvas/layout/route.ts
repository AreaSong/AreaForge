import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  knowledgeCanvasLayoutDeleteSchema,
  knowledgeCanvasLayoutPutSchema,
} from "@/lib/study/knowledge-canvas-contract";
import {
  resetKnowledgeCanvasLayout,
  saveKnowledgeCanvasLayout,
} from "@/lib/study/knowledge-canvas-service";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = knowledgeCanvasLayoutPutSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ layout: await saveKnowledgeCanvasLayout(user.id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = knowledgeCanvasLayoutDeleteSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ layout: await resetKnowledgeCanvasLayout(user.id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
