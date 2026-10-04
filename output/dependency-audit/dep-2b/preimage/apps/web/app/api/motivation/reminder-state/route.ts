import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { motivationReminderStateSchema } from "@/lib/study/schemas";
import { updateMotivationReminderState } from "@/lib/study/motivation-library-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = motivationReminderStateSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json(await updateMotivationReminderState(user.id, parsed.data));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
