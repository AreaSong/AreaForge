import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { studySessionHeartbeatSchema } from "@/lib/study/schemas";
import { heartbeatStudySession } from "@/lib/study/session-lifecycle-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = studySessionHeartbeatSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      session: await heartbeatStudySession(id, {
        clientDeviceId: request.headers.get("x-areaforge-device-id") ?? parsed.data.clientDeviceId,
        clientDeviceLabel: request.headers.get("x-areaforge-device-label") ?? parsed.data.clientDeviceLabel,
      }, user.id),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
