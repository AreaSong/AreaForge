import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createKnowledgePointSchema } from "@/lib/study/schemas";
import { createKnowledgePoint, listKnowledgePoints } from "@/lib/study/knowledge-point-service";
import { MASTERY_STATUS_OPTIONS, type MasteryStatus } from "@/lib/knowledge/mastery-status";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const params = request.nextUrl.searchParams;
    const masteryStatus = params.get("masteryStatus");
    const masteryState = params.get("masteryState");
    const allowedMasteryStates = ["UNTOUCHED", "LEARNING", "INITIAL_MASTERY", "STABLE_MASTERY", "NEEDS_RETEST"] as const;
    return NextResponse.json({
      knowledgePoints: await listKnowledgePoints(user.id, {
        subjectId: params.get("subjectId") ?? undefined,
        q: params.get("q") ?? undefined,
        masteryStatus: MASTERY_STATUS_OPTIONS.includes(masteryStatus as MasteryStatus)
          ? masteryStatus as MasteryStatus
          : undefined,
        masteryState: allowedMasteryStates.includes(masteryState as (typeof allowedMasteryStates)[number])
          ? masteryState as (typeof allowedMasteryStates)[number]
          : undefined,
      }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = createKnowledgePointSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ knowledgePoint: await createKnowledgePoint(user.id, parsed.data) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
