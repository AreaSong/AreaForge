import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { getLearningTreeImport, setLearningTreeImportArchived } from "@/lib/study/learning-tree-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ import: await getLearningTreeImport(user.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const patchSchema = z.object({ archived: z.boolean() });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const parsed = patchSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id } = await context.params;
    return NextResponse.json({
      import: await setLearningTreeImportArchived(user.id, id, parsed.data.archived),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
