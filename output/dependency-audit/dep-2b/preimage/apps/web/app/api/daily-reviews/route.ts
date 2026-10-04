import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { ApiError, apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { getDailyReviewMinimumInboxItem } from "@/lib/study/plan-inbox-service";
import { saveReviewSchema } from "@/lib/study/schemas";
import { createDailyReview, getDailyReview } from "@/lib/study/daily-review-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ review: await getDailyReview(user.id, parseReviewDate(request.nextUrl.searchParams.get("date"))) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = saveReviewSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const review = await createDailyReview(parsed.data, user.id);
    const inboxItem = await getDailyReviewMinimumInboxItem(user.id, review);
    return NextResponse.json({ review, inboxItem }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function parseReviewDate(value: string | null): Date {
  if (!value) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError("INVALID_REVIEW_DATE", 400);
  const date = new Date(`${value}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) throw new ApiError("INVALID_REVIEW_DATE", 400);
  return date;
}
