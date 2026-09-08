import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { updateUserNotification } from "@/lib/notifications/inbox-service";
import { userNotificationActionSchema } from "@/lib/notifications/schemas";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = userNotificationActionSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id } = await context.params;
    return NextResponse.json({
      notification: await updateUserNotification(actor.id, id, parsed.data.action, parsed.data.expectedRevision),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
