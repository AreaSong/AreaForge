import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createPlanMilestone, listPlanMilestones } from "@/lib/study/plan-milestone-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  stagePlanId: z.string().min(1),
  expectedStagePlanRevision: z.number().int().positive().optional(),
  stableKey: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  subjectId: z.string().nullable().optional(),
  targetDate: z.string().datetime().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ milestones: await listPlanMilestones(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const input = {
      ...parsed.data,
      idempotencyKey: parsed.data.idempotencyKey
        ?? `plan-milestone:${parsed.data.stagePlanId}:${parsed.data.stableKey}`,
    };
    return NextResponse.json({ milestone: await createPlanMilestone(user.id, input) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
