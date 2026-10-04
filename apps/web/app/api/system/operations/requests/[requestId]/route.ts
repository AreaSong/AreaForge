import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { requirePlatformOperator } from "@/lib/system/operator-policy";
import { getControlledOperationRequest } from "@/lib/system/controlled-operation-request-service";
import { listControlledOperationEvidence } from "@/lib/system/controlled-operation-evidence-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  try {
    const actor = await requireApiUser(request);
    await requirePlatformOperator(actor);
    const { requestId } = await context.params;
    return NextResponse.json({ request: await getControlledOperationRequest(actor, requestId), evidence: await listControlledOperationEvidence(actor, requestId) },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
