import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getPlanRolling } from "@/lib/study/plan-rolling-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const { searchParams } = new URL(request.url);
    return NextResponse.json({
      plan: await getPlanRolling(user.id, {
        date: searchParams.get("date") ?? undefined,
        subjectId: searchParams.get("subjectId") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        q: searchParams.get("q") ?? undefined,
      }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
