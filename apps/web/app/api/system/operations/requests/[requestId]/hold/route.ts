import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { requirePlatformOperator } from "@/lib/system/operator-policy";
import {
  controlledOperationHoldSchema,
  holdControlledOperationRequest,
} from "@/lib/system/controlled-operation-request-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  try {
    const actor = await requireApiUser(request);
    await requirePlatformOperator(actor, { fresh: true });
    const parsed = controlledOperationHoldSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { requestId } = await context.params;
    return NextResponse.json({ request: await holdControlledOperationRequest(actor, requestId, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
