import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { convertPlanInboxItem } from "@/lib/study/plan-inbox-service";

export const dynamic = "force-dynamic";

export const planInboxConvertSchema = z.object({
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = planInboxConvertSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      item: await convertPlanInboxItem(user.id, id, parsed.data),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
