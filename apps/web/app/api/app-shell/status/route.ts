import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getAppShellStatus } from "@/lib/study/app-shell-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ status: await getAppShellStatus(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
