import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { requirePlatformOperator } from "@/lib/system/operator-policy";
import { listControlledOperations } from "@/lib/system/controlled-operation";

export const dynamic = "force-dynamic";

/**
 * 只读返回 operation catalog；此 route 不接受 intent，也不触发 agent/updater。
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    await requirePlatformOperator(actor);
    return NextResponse.json({ operations: listControlledOperations() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
