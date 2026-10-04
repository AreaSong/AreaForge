import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createBridgeTask } from "@/lib/study/review-schedule-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  subjectId: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1).optional(),
  estimatedMinutes: z.number().int().positive().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json(
      await createBridgeTask(user.id, { reviewScheduleId: id, ...parsed.data }),
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
