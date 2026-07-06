import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { deferTaskSchema } from "@/lib/study/schemas";
import { deferStudyTask } from "@/lib/study/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = deferTaskSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({
      task: await deferStudyTask(id, parsed.data.plannedDate, parsed.data.reviewText, user.id),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
