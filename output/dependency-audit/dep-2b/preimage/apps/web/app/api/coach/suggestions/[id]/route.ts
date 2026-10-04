import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { decideCoachSuggestion } from "@/lib/coach/coach-suggestion-service";

export const dynamic = "force-dynamic";
const decisionSchema = z.object({
  action: z.enum(["accept", "reject", "revoke"]),
  expectedRevision: z.number().int().positive(),
}).strict();

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = decisionSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id } = await context.params;
    return NextResponse.json({ suggestion: await decideCoachSuggestion(actor.id, id, parsed.data.action, parsed.data.expectedRevision) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
