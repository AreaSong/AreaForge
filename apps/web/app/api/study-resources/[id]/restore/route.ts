import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { studyResourceRevisionCommandSchema } from "@/lib/study/schemas";
import { restoreStudyResource } from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = studyResourceRevisionCommandSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ resource: await restoreStudyResource(user.id, id, parsed.data.expectedRevision) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
