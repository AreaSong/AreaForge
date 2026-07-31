import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  getAiProviderPreferenceCookieName,
  getAiProviderPreferenceCookieOptions,
  readAiProviderPreferenceFromRequest,
  serializeAiProviderPreference,
} from "@/lib/study/ai-provider-preference";
import { patchAiProviderPreferenceSchema } from "@/lib/study/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    return NextResponse.json({ preference: readAiProviderPreferenceFromRequest(request) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireApiUser(request);
    const parsed = patchAiProviderPreferenceSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    const preference = {
      externalProviderEnabled: parsed.data.externalProviderEnabled,
      scope: "current_browser" as const,
    };
    const response = NextResponse.json({ preference });
    response.cookies.set(
      getAiProviderPreferenceCookieName(),
      serializeAiProviderPreference(preference.externalProviderEnabled),
      getAiProviderPreferenceCookieOptions(),
    );
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
