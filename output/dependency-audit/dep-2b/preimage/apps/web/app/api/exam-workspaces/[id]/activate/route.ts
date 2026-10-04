import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { activateExamWorkspace } from "@/lib/study/exam-workspace-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  expectedRevision: z.number().int().positive(),
  expectedSelectionRevision: z.number().int().positive().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      workspace: await activateExamWorkspace(user.id, id, parsed.data.expectedRevision, parsed.data.expectedSelectionRevision),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
