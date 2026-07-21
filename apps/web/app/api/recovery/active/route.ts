import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getActiveRecoveryV2 } from "@/lib/study/recovery-v2-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ recovery: await getActiveRecoveryV2(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
