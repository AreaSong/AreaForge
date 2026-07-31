import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  createUserPlanInboxItem,
  listPlanInboxItems,
} from "@/lib/study/plan-inbox-service";

export const dynamic = "force-dynamic";

export const planInboxClientCreateSchema = z.object({
  clientRequestKey: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(200),
  subjectId: z.string().nullable().optional(),
  plannedDate: z.string().datetime().nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  priority: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  planMilestoneId: z.string().nullable().optional(),
  primaryNodeId: z.string().nullable().optional(),
  relatedNodeIds: z.array(z.string().min(1)).max(50).optional(),
  predecessorTasks: z.array(z.object({
    taskId: z.string().min(1),
    dependencyType: z.enum(["SOFT", "HARD"]),
  })).max(50).optional(),
}).strict();

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
    const parsed = planInboxClientCreateSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ item: await createUserPlanInboxItem(user.id, parsed.data) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
