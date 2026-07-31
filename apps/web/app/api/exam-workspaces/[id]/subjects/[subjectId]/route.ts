import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { updateWorkspaceSubject } from "@/lib/study/exam-workspace-service";

export const dynamic = "force-dynamic";
const patchSchema = z.object({
  expectedWorkspaceRevision: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  color: z.string().trim().min(1).max(32).optional(),
  sortOrder: z.number().int().optional(),
  groupId: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  move: z.enum(["UP", "DOWN"]).optional(),
})
  .refine((value) => Object.keys(value).some((key) => key !== "expectedWorkspaceRevision"), { message: "at least one field is required" })
  .refine(
    (value) => !value.move || [value.name, value.color, value.sortOrder, value.groupId, value.archived].every((field) => field === undefined),
    { message: "move cannot be combined with other fields" },
  );

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; subjectId: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id, subjectId } = await context.params;
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json(await updateWorkspaceSubject(user.id, id, subjectId, parsed.data));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
