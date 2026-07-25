import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { updateSimulationLossItem } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";
const patchSchema = z.object({
  expectedRevision: z.number().int().positive(),
  reason: z.enum(["CONCEPT_GAP", "MEMORY_FORMULA", "METHOD_ERROR", "CALCULATION_CARELESS", "TIME_ALLOCATION", "READING_COMPREHENSION", "UNFAMILIAR_PATTERN", "MINDSET", "UNANSWERED", "OTHER"]).optional(),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  lostScore: z.number().positive().max(1000).multipleOf(0.5).optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).refine((value) => Object.keys(value).some((key) => key !== "expectedRevision"), { message: "at least one field is required" });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; lossItemId: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id, lossItemId } = await context.params;
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ lossItem: await updateSimulationLossItem(id, lossItemId, parsed.data, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
