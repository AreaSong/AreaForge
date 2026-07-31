import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { listPeriodicReportDecisions } from "@/lib/study/report-decisions-service";
import { getPeriodicReports } from "@/lib/study/reports-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const tab = request.nextUrl.searchParams.get("tab");
    const period = request.nextUrl.searchParams.get("period");
    if (tab === "history") {
      const kind = period === "week" || period === "month" ? period : undefined;
      return NextResponse.json({ reports: await listPeriodicReportDecisions(kind, user.id) });
    }
    return NextResponse.json({ reports: await getPeriodicReports(new Date(), user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
