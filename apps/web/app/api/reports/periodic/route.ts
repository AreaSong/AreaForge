import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getPeriodicReports } from "@/lib/study/reports-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    return NextResponse.json({ reports: await getPeriodicReports() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
