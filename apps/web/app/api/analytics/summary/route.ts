import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getAnalyticsSummary } from "@/lib/study/analytics-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    return NextResponse.json({ analytics: await getAnalyticsSummary() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
