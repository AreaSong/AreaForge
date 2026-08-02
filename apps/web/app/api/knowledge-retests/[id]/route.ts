import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getKnowledgeRetest } from "@/lib/study/knowledge-retest-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const retest = await getKnowledgeRetest(user.id, id);
    if (!retest) return NextResponse.json({ error: "KNOWLEDGE_RETEST_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ retest });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
