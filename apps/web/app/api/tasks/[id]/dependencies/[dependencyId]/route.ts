import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { deleteTaskDependency, updateTaskDependencyType } from "@/lib/study/task-dependency-service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  type: z.enum(["SOFT", "HARD"]),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; dependencyId: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { dependencyId } = await context.params;
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      dependency: await updateTaskDependencyType(user.id, dependencyId, parsed.data.type),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; dependencyId: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { dependencyId } = await context.params;
    await deleteTaskDependency(user.id, dependencyId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
