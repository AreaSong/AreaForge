import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { listStudyResources } from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "1";
    const subjectId = request.nextUrl.searchParams.get("subjectId") ?? undefined;
    return NextResponse.json({
      resources: await listStudyResources(user.id, { includeArchived, subjectId }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
