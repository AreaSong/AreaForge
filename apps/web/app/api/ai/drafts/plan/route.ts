import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { handleAiDraftRequest } from "@/lib/study/ai-draft-service";
import { readAiProviderPreferenceFromRequest } from "@/lib/study/ai-provider-preference";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const preference = readAiProviderPreferenceFromRequest(request);
    const body = (await readJson(request)) as Record<string, unknown>;
    return NextResponse.json(await handleAiDraftRequest(user.id, "plan", body, {
      allowExternalProvider: preference.externalProviderEnabled,
    }));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
