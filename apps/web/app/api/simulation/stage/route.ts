import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getSimulationStageDraft } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    return NextResponse.json({ stage: await getSimulationStageDraft() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
