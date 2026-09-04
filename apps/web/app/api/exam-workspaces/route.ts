import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createExamWorkspace, listExamWorkspaces } from "@/lib/study/exam-workspace-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  stableKey: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  targetExamDate: z.string().datetime().nullable().optional(),
  stageSummary: z.string().max(500).nullable().optional(),
  activate: z.boolean().optional(),
  subjects: z.array(z.object({
    stableKey: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(120),
    color: z.string().trim().min(1).max(32),
    sortOrder: z.number().int().optional(),
    groupStableKey: z.string().trim().min(1).max(80).nullable().optional(),
  })).min(1).max(12).optional(),
  groups: z.array(z.object({
    stableKey: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(120),
    sortOrder: z.number().int().optional(),
  })).max(20).optional(),
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
    const user = await requireApiUser(request);
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ workspace: await createExamWorkspace(user.id, parsed.data) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
