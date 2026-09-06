import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { controlledOperationIntentSchema } from "@/lib/system/controlled-operation";
import { requirePlatformOperator } from "@/lib/system/operator-policy";
import {
  createControlledOperationRequest,
  listControlledOperationRequests,
} from "@/lib/system/controlled-operation-request-service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum([
    "PREVIEWED",
    "CONFIRMATION_REQUIRED",
    "APPROVAL_REQUIRED",
    "QUEUED",
    "RUNNING",
    "PAUSED",
    "HELD",
    "CANCEL_REQUESTED",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "EXPIRED",
  ]).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ requests: await listControlledOperationRequests(actor, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    await requirePlatformOperator(actor, { fresh: true });
    const parsed = controlledOperationIntentSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const operationRequest = await createControlledOperationRequest(actor, parsed.data);
    return NextResponse.json({ request: operationRequest }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
