import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { updateExamWorkspace } from "@/lib/study/exam-workspace-service";

export const dynamic = "force-dynamic";
const patchSchema = z.object({
  expectedRevision: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  targetExamDate: z.string().datetime().nullable().optional(),
  stageSummary: z.string().trim().max(500).nullable().optional(),
}).refine((value) => Object.keys(value).some((key) => key !== "expectedRevision"), { message: "at least one field is required" });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ workspace: await updateExamWorkspace(user.id, id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
