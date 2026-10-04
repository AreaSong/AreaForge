import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createAnalyticsRiskPlanInboxItem } from "@/lib/study/plan-inbox-service";

export const dynamic = "force-dynamic";

const analyticsRiskInboxSchema = z.object({
  riskId: z.string().min(1).max(160),
  riskType: z.enum(["weak_node", "note_review", "mistake_review", "review_gap", "low_completion", "low_effective"]),
  windowDays: z.union([z.literal(7), z.literal(30)]),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = analyticsRiskInboxSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      item: await createAnalyticsRiskPlanInboxItem(user.id, parsed.data),
    }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
