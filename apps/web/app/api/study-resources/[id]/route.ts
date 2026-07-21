import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  getStudyResource,
  updateStudyResource,
} from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  category: z.string().optional(),
  subjectId: z.string().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  expectedRevision: z.number().int().positive(),
});

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ resource: await getStudyResource(user.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ resource: await updateStudyResource(user.id, id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
