import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getPeriodicReport } from "@/lib/study/reports-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const period = request.nextUrl.searchParams.get("period") === "month" ? "month" : "week";
    return NextResponse.json({ report: await getPeriodicReport(period, new Date(), user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
