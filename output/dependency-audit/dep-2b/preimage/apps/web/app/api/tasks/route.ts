import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createTaskSchema } from "@/lib/study/schemas";
import { createStudyTask } from "@/lib/study/task-command-service";
import { listStudyTasks } from "@/lib/study/study-query-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ tasks: await listStudyTasks(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = createTaskSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({ task: await createStudyTask(parsed.data, user.id) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
