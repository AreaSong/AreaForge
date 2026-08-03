import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { startSessionSchema } from "@/lib/study/schemas";
import { startStudySession } from "@/lib/study/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const rawBody = await readJson(request);
    const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? {
          ...rawBody,
          idempotencyKey: (rawBody as Record<string, unknown>).idempotencyKey
            ?? request.headers.get("idempotency-key")
            ?? undefined,
        }
      : rawBody;
    const parsed = startSessionSchema.safeParse(body);
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({
      session: await startStudySession({
        ...parsed.data,
        clientDeviceId: request.headers.get("x-areaforge-device-id") ?? parsed.data.clientDeviceId,
        clientDeviceLabel: request.headers.get("x-areaforge-device-label") ?? parsed.data.clientDeviceLabel,
      }, user.id),
    }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
