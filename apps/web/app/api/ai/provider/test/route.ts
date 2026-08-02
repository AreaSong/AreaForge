import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { readAiProviderPreferenceFromRequest } from "@/lib/study/ai-provider-preference";
import { recordAiProviderTest } from "@/lib/study/ai-provider-credential-service";
import { testConfiguredAiProviderForUser } from "@/lib/study/ai-service";
import { testAiProviderSchema } from "@/lib/study/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = testAiProviderSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    const preference = readAiProviderPreferenceFromRequest(request);
    const result = await testConfiguredAiProviderForUser(user.id, preference.externalProviderEnabled);
    await recordAiProviderTest(user.id, result.success ? "success" : result.externalCall ? "failed" : "blocked");
    return NextResponse.json({ test: result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
