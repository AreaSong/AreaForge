import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { listUserNotifications } from "@/lib/notifications/inbox-service";
import type { UserNotificationFilter } from "@/lib/contracts/notification";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const requested = request.nextUrl.searchParams.get("filter");
    const filter: UserNotificationFilter = requested === "all" || requested === "dismissed" ? requested : "unread";
    return NextResponse.json({ notifications: await listUserNotifications(actor.id, filter) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
