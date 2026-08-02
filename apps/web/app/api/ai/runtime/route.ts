import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  getAiRuntimeSettingStatus,
  updateAiRuntimeSetting,
} from "@/lib/study/ai-runtime-setting-service";
import { patchAiRuntimeSettingSchema } from "@/lib/study/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    return NextResponse.json({ runtime: await getAiRuntimeSettingStatus() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = patchAiRuntimeSettingSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({
      runtime: await updateAiRuntimeSetting(user.id, parsed.data),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
