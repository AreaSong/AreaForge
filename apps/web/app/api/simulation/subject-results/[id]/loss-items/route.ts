import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createSimulationLossItem, listSimulationLossItems } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";
const lossItemSchema = z.object({
  reason: z.enum(["CONCEPT_GAP", "MEMORY_FORMULA", "METHOD_ERROR", "CALCULATION_CARELESS", "TIME_ALLOCATION", "READING_COMPREHENSION", "UNFAMILIAR_PATTERN", "MINDSET", "UNANSWERED", "OTHER"]),
  syllabusNodeId: z.string().min(1).nullable().optional(),
  lostScore: z.number().positive().max(1000).multipleOf(0.5),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ lossItems: await listSimulationLossItems(id, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = lossItemSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ lossItem: await createSimulationLossItem(id, parsed.data, user.id) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
