import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  getReviewSchedule,
  rescheduleReview,
} from "@/lib/study/review-schedule-service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  expectedRevision: z.number().int().positive(),
  dueDate: z.string().min(1),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ schedule: await getReviewSchedule(user.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      schedule: await rescheduleReview(user.id, id, parsed.data),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
