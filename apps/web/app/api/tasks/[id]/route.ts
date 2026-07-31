import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { updateTaskSchema } from "@/lib/study/schemas";
import { updateStudyTask } from "@/lib/study/service";
import { getStudyTaskDetail } from "@/lib/study/task-detail-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ detail: await getStudyTaskDetail(user.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = updateTaskSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({ task: await updateStudyTask(id, parsed.data, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
