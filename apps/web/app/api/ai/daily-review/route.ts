import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getDailyReviewAiAdvice } from "@/lib/study/ai-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json(await getDailyReviewAiAdvice({ allowExternalProvider: true, userId: user.id }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
