import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createMasteryRetestSchema } from "@/lib/study/schemas";
import { addMasteryRetest } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = createMasteryRetestSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({ node: await addMasteryRetest(id, parsed.data, user.id) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
