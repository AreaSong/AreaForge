import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  createPlanInboxItem,
  listPlanInboxItems,
} from "@/lib/study/plan-inbox-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  stableKey: z.string().trim().min(1).max(80),
  originKey: z.string().trim().min(1).max(160),
  originVersion: z.number().int().positive(),
  originType: z.string().trim().min(1).max(80),
  originSnapshot: z.record(z.string(), z.unknown()),
  title: z.string().trim().min(1).max(200),
  subjectId: z.string().nullable().optional(),
  plannedDate: z.string().datetime().nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  priority: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  planMilestoneId: z.string().nullable().optional(),
  primaryNodeId: z.string().nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const status = request.nextUrl.searchParams.get("status");
    const parsedStatus =
      status === "OPEN" || status === "DISMISSED" || status === "CONVERTED" ? status : undefined;
    return NextResponse.json({ items: await listPlanInboxItems(user.id, parsedStatus) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = createSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ item: await createPlanInboxItem(user.id, parsed.data) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
