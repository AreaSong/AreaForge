import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { readAiProviderPreferenceFromRequest } from "@/lib/study/ai-provider-preference";
import { aiStageAdjustmentDraftSchema } from "@/lib/study/schemas";
import { createAiStageAdjustmentDraft } from "@/lib/study/long-term-stage-ai-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const preference = readAiProviderPreferenceFromRequest(request);
    const parsed = aiStageAdjustmentDraftSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json(
      await createAiStageAdjustmentDraft(parsed.data, user.id, {
        allowExternalProvider: preference.externalProviderEnabled,
        userId: user.id,
      }),
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
