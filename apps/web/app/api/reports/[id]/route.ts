import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { ApiError, apiErrorResponse } from "@/lib/api/responses";
import { getPeriodicReportDecision } from "@/lib/study/report-decisions-service";
import { getPeriodicReport } from "@/lib/study/reports-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const kind = id.startsWith("month:") ? "month" : id.startsWith("week:") ? "week" : null;
    if (kind) {
      const report = await getPeriodicReport(kind, new Date(), user.id);
      if (report.id !== id) throw new ApiError("PERIODIC_REPORT_NOT_FOUND", 404);
      return NextResponse.json({ report });
    }
    return NextResponse.json({ report: await getPeriodicReportDecision(id, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
