import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { taskDebtReorderDecisionSchema } from "@/lib/study/schemas";
import { decideTaskDebtReorder } from "@/lib/study/task-debt-reorder-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = taskDebtReorderDecisionSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({
      decision: await decideTaskDebtReorder(parsed.data, user.id),
    }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
