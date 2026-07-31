import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { completeBridgeTaskWithReview } from "@/lib/study/review-schedule-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  idempotencyKey: z.string().min(8),
  expectedRevision: z.number().int().positive(),
  result: z.enum(["PASSED", "PARTIAL", "FAILED"]),
  durationSeconds: z.number().int().positive(),
  nextDueDate: z.string().min(1).optional(),
  note: z.string().max(2000).nullable().optional(),
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
    return NextResponse.json(await completeBridgeTaskWithReview(user.id, id, parsed.data));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
