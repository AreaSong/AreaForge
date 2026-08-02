import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { getDailyReviewMinimumInboxItem } from "@/lib/study/plan-inbox-service";
import { saveTodayReviewSchema } from "@/lib/study/schemas";
import { getTodayReview, saveTodayReview } from "@/lib/study/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ review: await getTodayReview(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = saveTodayReviewSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    const review = await saveTodayReview(parsed.data, user.id);
    const inboxItem = await getDailyReviewMinimumInboxItem(user.id, review);
    return NextResponse.json({ review, inboxItem });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
