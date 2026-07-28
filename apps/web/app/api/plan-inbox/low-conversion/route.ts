import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createLowConversionPlanInboxItem } from "@/lib/study/plan-inbox-service";

export const dynamic = "force-dynamic";

export const lowConversionInboxSchema = z.object({
  sessionId: z.string().min(1),
  expectedCloseoutVersion: z.number().int().positive(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = lowConversionInboxSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      item: await createLowConversionPlanInboxItem(user.id, parsed.data),
    }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
