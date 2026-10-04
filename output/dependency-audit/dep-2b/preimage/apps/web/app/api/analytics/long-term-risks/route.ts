import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getLongTermRiskSummary } from "@/lib/study/long-term-risk-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ longTermRisks: await getLongTermRiskSummary(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
