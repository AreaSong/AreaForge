import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getLongTermRiskSummary } from "@/lib/study/long-term-risk-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    return NextResponse.json({ longTermRisks: await getLongTermRiskSummary() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
