import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { taskDebtReorderApplicationSchema } from "@/lib/study/schemas";
import { applyTaskDebtReorder } from "@/lib/study/task-debt-reorder-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = taskDebtReorderApplicationSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const application = await applyTaskDebtReorder(parsed.data, user.id);

    return NextResponse.json({
      application,
    }, { status: application.applied.length > 0 ? 201 : 200 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
