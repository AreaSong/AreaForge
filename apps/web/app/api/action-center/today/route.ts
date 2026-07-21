import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getActionCenterToday } from "@/lib/study/action-center-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ today: await getActionCenterToday(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
