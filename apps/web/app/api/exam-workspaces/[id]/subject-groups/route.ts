import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createSubjectGroup, listSubjectGroups } from "@/lib/study/exam-workspace-service";

export const dynamic = "force-dynamic";
const createSchema = z.object({ expectedWorkspaceRevision: z.number().int().positive(), stableKey: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(120), sortOrder: z.number().int().optional() });

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ groups: await listSubjectGroups(user.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json(await createSubjectGroup(user.id, id, parsed.data), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
