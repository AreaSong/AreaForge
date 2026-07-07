import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getTodayDashboard } from "@/lib/study/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({
      dashboard: await getTodayDashboard(new Date(), {
        actorId: user.id,
        recordRecoveryRule: true,
      }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
