import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { readAiProviderPreferenceFromRequest } from "@/lib/study/ai-provider-preference";
import { getTomorrowPlanAiAdvice } from "@/lib/study/ai-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const preference = readAiProviderPreferenceFromRequest(request);
    return NextResponse.json(await getTomorrowPlanAiAdvice({
      allowExternalProvider: preference.externalProviderEnabled,
      userId: user.id,
    }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
