import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createCoachSuggestion, listCoachSuggestions } from "@/lib/coach/coach-suggestion-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  workspaceId: z.string().trim().min(1).max(191),
  resourceType: z.enum(["NOTE", "MISTAKE", "ATTACHMENT"]),
  resourceId: z.string().trim().min(1).max(191),
  payload: z.object({
    title: z.string().trim().min(1).max(200),
    plannedDate: z.string().datetime().nullable(),
    estimatedMinutes: z.number().int().min(1).max(1440).nullable(),
    priority: z.string().trim().max(32).nullable(),
    type: z.string().trim().max(64).nullable(),
    subjectId: z.string().trim().max(191).nullable(),
    primaryNodeId: z.string().trim().max(191).nullable(),
  }).strict(),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    return NextResponse.json({ suggestions: await listCoachSuggestions(actor.id, request.nextUrl.searchParams.get("workspaceId") ?? undefined) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ suggestion: await createCoachSuggestion(actor, parsed.data) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
