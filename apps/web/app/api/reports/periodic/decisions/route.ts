import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { decidePeriodicReport, listPeriodicReportDecisions } from "@/lib/study/report-decisions-service";
import { periodicReportDecisionSchema } from "@/lib/study/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const kind = request.nextUrl.searchParams.get("kind");
    const decisions = await listPeriodicReportDecisions(kind === "week" || kind === "month" ? kind : undefined, user.id);
    return NextResponse.json({ decisions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = periodicReportDecisionSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const decision = await decidePeriodicReport(parsed.data, user.id);
    return NextResponse.json({ decision }, { status: decision.alreadyDecided ? 200 : 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
