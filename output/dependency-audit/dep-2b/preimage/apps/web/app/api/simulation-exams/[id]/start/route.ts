import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { simulationExamCommandSchema } from "@/lib/study/schemas";
import { startSimulationExam } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = simulationExamCommandSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ exam: await startSimulationExam(id, parsed.data, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
