import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { STUDY_RESOURCE_CATEGORIES } from "@areaforge/core";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { resolveStudyResourceUpload } from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";

const categorySchema = z.enum(STUDY_RESOURCE_CATEGORIES);
const schema = z.object({
  attachmentId: z.string().min(1),
  decision: z.enum(["reuse", "copy", "skip"]),
  reuseResourceId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  subjectId: z.string().nullable().optional(),
  category: categorySchema.optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  stableKey: z.string().trim().min(1).max(80).optional(),
  taskIds: z.array(z.string().min(1)).max(100).optional(),
  noteIds: z.array(z.string().min(1)).max(100).optional(),
  mistakeIds: z.array(z.string().min(1)).max(100).optional(),
  syllabusNodeIds: z.array(z.string().min(1)).max(500).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const result = await resolveStudyResourceUpload(user.id, parsed.data);
    // Keep a stable envelope for both a created resource and an explicit skip.
    // The workbench uses the same per-item contract for all batch decisions.
    return NextResponse.json("skipped" in result ? result : { resource: result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
