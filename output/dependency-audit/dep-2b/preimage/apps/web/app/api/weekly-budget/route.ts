import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { patchWeeklyBudgetSchema } from "@/lib/study/schemas";
import { getWeeklyBudget, patchWeeklyBudget } from "@/lib/study/weekly-budget-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({
      budget: await getWeeklyBudget(user.id, request.nextUrl.searchParams.get("weekStart")),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = patchWeeklyBudgetSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ budget: await patchWeeklyBudget(user.id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
