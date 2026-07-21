import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { KNOWLEDGE_CANVAS_ENTITY_TYPES } from "@areaforge/core";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  resetKnowledgeCanvasLayout,
  saveKnowledgeCanvasLayout,
} from "@/lib/study/knowledge-canvas-service";

export const dynamic = "force-dynamic";

const nodeSchema = z.object({
  entityType: z.enum(KNOWLEDGE_CANVAS_ENTITY_TYPES),
  entityId: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  collapsed: z.boolean().optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

const putSchema = z.object({
  workspaceId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  viewportX: z.number().finite().optional(),
  viewportY: z.number().finite().optional(),
  viewportZoom: z.number().finite().positive().optional(),
  nodes: z.array(nodeSchema).max(500).optional(),
});

const deleteSchema = z.object({
  workspaceId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
});

export async function PUT(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = putSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ layout: await saveKnowledgeCanvasLayout(user.id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = deleteSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ layout: await resetKnowledgeCanvasLayout(user.id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
