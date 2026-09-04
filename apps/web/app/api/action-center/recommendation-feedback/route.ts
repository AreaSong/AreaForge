import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { recordActionCenterRecommendationFeedback } from "@/lib/study/action-center-service";
import { actionCenterRecommendationFeedbackSchema } from "@/lib/study/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = actionCenterRecommendationFeedbackSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      today: await recordActionCenterRecommendationFeedback(user.id, parsed.data),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
