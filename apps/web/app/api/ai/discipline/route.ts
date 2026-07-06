import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getDisciplineAiAdvice } from "@/lib/study/ai-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireApiUser(request);
    return NextResponse.json(await getDisciplineAiAdvice());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
