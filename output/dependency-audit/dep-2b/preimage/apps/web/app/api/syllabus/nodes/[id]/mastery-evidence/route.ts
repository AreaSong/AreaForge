import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createMasteryEvidenceSchema } from "@/lib/study/schemas";
import { addMasteryEvidence } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = createMasteryEvidenceSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({ node: await addMasteryEvidence(id, parsed.data, user.id) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
