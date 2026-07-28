import { NextRequest, NextResponse } from "next/server";
import { AI_DRAFT_RESULT_PROOF_MAX_LENGTH } from "@areaforge/auth";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { adoptAiPlanDraftToInbox } from "@/lib/study/plan-inbox-service";

export const dynamic = "force-dynamic";

export const aiPlanAdoptionSchema = z.object({
  operationId: z.string().uuid(),
  projectionVersion: z.string().trim().min(1).max(80),
  resultProof: z.string().min(1).max(AI_DRAFT_RESULT_PROOF_MAX_LENGTH),
  tasks: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    plannedDate: z.string().datetime().nullable().optional(),
    estimatedMinutes: z.number().int().min(5).max(480),
  }).strict()).min(1).max(8),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = aiPlanAdoptionSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      items: await adoptAiPlanDraftToInbox(user.id, parsed.data),
    }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
