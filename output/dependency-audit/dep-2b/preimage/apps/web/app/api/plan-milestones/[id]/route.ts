import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { updatePlanMilestone } from "@/lib/study/plan-milestone-service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  expectedRevision: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  targetDate: z.string().datetime().nullable().optional(),
  sortOrder: z.number().int().optional(),
  status: z.string().trim().min(1).max(40).optional(),
  archive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ milestone: await updatePlanMilestone(user.id, id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
