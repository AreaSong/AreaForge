import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { listLearningTreeImports } from "@/lib/study/learning-tree-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "1";
    return NextResponse.json({ imports: await listLearningTreeImports(user.id, { includeArchived }) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
