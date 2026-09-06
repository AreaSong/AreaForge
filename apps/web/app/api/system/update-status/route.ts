import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getUpdateCenterStatus } from "@/lib/system/update-center";
import { requirePlatformOperator } from "@/lib/system/operator-policy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    await requirePlatformOperator(actor);
    return NextResponse.json({ status: await getUpdateCenterStatus() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
