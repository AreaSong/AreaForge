import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { handleAiDraftRequest } from "@/lib/study/ai-draft-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = (await readJson(request)) as Record<string, unknown>;
    return NextResponse.json(await handleAiDraftRequest(user.id, "knowledge-card", body));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
