import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, ApiError } from "@/lib/api/responses";
import { listWorkspaceCheckIns } from "@/lib/study/check-in-service";
import { resolveActiveWorkspace } from "@/lib/study/exam-workspace-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    if (!from || !to) throw new ApiError("CHECK_IN_RANGE_REQUIRED", 400);
    const workspace = await resolveActiveWorkspace(user.id);
    return NextResponse.json({
      checkIns: await listWorkspaceCheckIns(workspace.id, new Date(from), new Date(to)),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
