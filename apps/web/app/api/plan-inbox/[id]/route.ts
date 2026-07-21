import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { updatePlanInboxItem } from "@/lib/study/plan-inbox-service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  expectedRevision: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  plannedDate: z.string().datetime().nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  priority: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  planMilestoneId: z.string().nullable().optional(),
  primaryNodeId: z.string().nullable().optional(),
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
    return NextResponse.json({ item: await updatePlanInboxItem(user.id, id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
