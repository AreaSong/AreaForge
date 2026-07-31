import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createTaskDependency, listTaskDependencies } from "@/lib/study/task-dependency-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  predecessorId: z.string().min(1),
  type: z.enum(["SOFT", "HARD"]).optional(),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ dependencies: await listTaskDependencies(user.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id: successorId } = await context.params;
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json(
      {
        dependency: await createTaskDependency(user.id, {
          predecessorId: parsed.data.predecessorId,
          successorId,
          type: parsed.data.type,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
