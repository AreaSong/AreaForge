import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getLearningTreeImport } from "@/lib/study/learning-tree-service";

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
