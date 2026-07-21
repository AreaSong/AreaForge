import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { addSimulationRemediationsToInbox, listSimulationRemediations } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";

const commandSchema = z.object({
  selections: z.array(z.object({
    originKey: z.string().min(1),
    originVersion: z.number().int().min(1),
  })).min(1).max(50),
});

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ remediations: await listSimulationRemediations(id, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = commandSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json(await addSimulationRemediationsToInbox(id, user.id, parsed.data.selections));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
