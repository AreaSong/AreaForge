import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { submitKnowledgeRetestSchema } from "@/lib/study/schemas";
import { submitKnowledgeRetest } from "@/lib/study/knowledge-retest-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = submitKnowledgeRetestSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ retest: await submitKnowledgeRetest(user.id, id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
