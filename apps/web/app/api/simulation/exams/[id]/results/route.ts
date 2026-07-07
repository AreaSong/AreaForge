import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { saveSimulationExamResultsSchema } from "@/lib/study/schemas";
import { saveSimulationExamResults } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = saveSimulationExamResultsSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({ exam: await saveSimulationExamResults(id, parsed.data, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
