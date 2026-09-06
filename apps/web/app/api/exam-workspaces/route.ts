import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createExamWorkspace, listExamWorkspaces } from "@/lib/study/exam-workspace-service";
import { EXAM_WORKSPACE_LIMITS } from "@areaforge/core";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  stableKey: z.string().trim().min(1).max(EXAM_WORKSPACE_LIMITS.stableKeyMaxLength),
  name: z.string().trim().min(1).max(EXAM_WORKSPACE_LIMITS.nameMaxLength),
  targetExamDate: z.string().datetime().nullable().optional(),
  stageSummary: z.string().max(500).nullable().optional(),
  activate: z.boolean().optional(),
  subjects: z.array(z.object({
    stableKey: z.string().trim().min(1).max(EXAM_WORKSPACE_LIMITS.subjectStableKeyMaxLength),
    name: z.string().trim().min(1).max(EXAM_WORKSPACE_LIMITS.subjectNameMaxLength),
    color: z.string().trim().min(1).max(32),
    sortOrder: z.number().int().optional(),
    groupStableKey: z.string().trim().min(1).max(80).nullable().optional(),
  })).min(1).max(EXAM_WORKSPACE_LIMITS.maxInitialSubjects).optional(),
  groups: z.array(z.object({
    stableKey: z.string().trim().min(1).max(EXAM_WORKSPACE_LIMITS.groupStableKeyMaxLength),
    name: z.string().trim().min(1).max(EXAM_WORKSPACE_LIMITS.groupNameMaxLength),
    sortOrder: z.number().int().optional(),
  })).max(EXAM_WORKSPACE_LIMITS.maxInitialGroups).optional(),
  takeoverSubjectIds: z.array(z.string().min(1)).max(100).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ workspaces: await listExamWorkspaces(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireApiUser(request);
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ workspace: await createExamWorkspace(user.id, parsed.data) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
