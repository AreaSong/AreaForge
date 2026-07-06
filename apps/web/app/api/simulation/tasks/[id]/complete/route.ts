import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { completeSimulationTaskSchema } from "@/lib/study/schemas";
import { completeSimulationTask } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = completeSimulationTaskSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({ task: await completeSimulationTask(id, parsed.data, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
