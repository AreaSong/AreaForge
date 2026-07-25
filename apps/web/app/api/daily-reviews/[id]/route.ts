import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { updateReviewSchema } from "@/lib/study/schemas";
import { updateDailyReview } from "@/lib/study/service";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const parsed = updateReviewSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id } = await context.params;
    return NextResponse.json({ review: await updateDailyReview(id, parsed.data, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
