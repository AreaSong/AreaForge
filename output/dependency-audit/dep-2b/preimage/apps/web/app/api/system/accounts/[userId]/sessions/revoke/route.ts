import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { revokeOperatorTargetSessions } from "@/lib/system/account-management-service";

export const dynamic = "force-dynamic";
const schema = z.object({
  reason: z.enum(["SECURITY_REVIEW", "USER_REQUEST", "ABUSE_PREVENTION", "INCIDENT_RESPONSE"]),
}).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ userId: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { userId } = await context.params;
    return NextResponse.json(await revokeOperatorTargetSessions(actor, userId, parsed.data.reason));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
