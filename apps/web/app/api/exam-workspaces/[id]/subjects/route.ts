import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createWorkspaceSubject } from "@/lib/study/exam-workspace-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  stableKey: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  color: z.string().trim().min(1).max(32),
  sortOrder: z.number().int().optional(),
  groupId: z.string().nullable().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json(
      { subject: await createWorkspaceSubject(user.id, id, parsed.data) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
