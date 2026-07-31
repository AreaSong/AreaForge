import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { restoreSimulationLossItemCommand } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";
const bodySchema = z.object({
  expectedRevision: z.number().int().positive(),
  expectedExamRevision: z.number().int().positive(),
  expectedSubjectResultRevision: z.number().int().positive(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; lossItemId: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id, lossItemId } = await context.params;
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json(await restoreSimulationLossItemCommand(id, lossItemId, parsed.data, user.id));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
