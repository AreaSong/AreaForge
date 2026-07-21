import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { patchNotificationPreferencesSchema } from "@/lib/study/schemas";
import {
  getNotificationPreferences,
  patchNotificationPreferences,
} from "@/lib/study/notification-preferences-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ preference: await getNotificationPreferences(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = patchNotificationPreferencesSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      preference: await patchNotificationPreferences(user.id, parsed.data),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
