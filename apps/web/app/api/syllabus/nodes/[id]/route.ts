import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { updateSyllabusNodeSchema } from "@/lib/study/schemas";
import { updateSyllabusNode } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = updateSyllabusNodeSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({ node: await updateSyllabusNode(id, parsed.data, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
