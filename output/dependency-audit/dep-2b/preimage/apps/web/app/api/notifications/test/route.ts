import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { testNotificationSchema } from "@/lib/study/schemas";
import { buildTestNotificationPayload } from "@/lib/study/notification-preferences-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireApiUser(request);
    const parsed = testNotificationSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      payload: buildTestNotificationPayload(parsed.data.category),
      note: "仅返回最小 payload；浏览器 permission 由当前设备决定，服务端不伪造授权、不持久化测试正文。",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
