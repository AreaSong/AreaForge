import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { ApiError, apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { decidePeriodicReport } from "@/lib/study/report-decisions-service";
import { getPeriodicReport } from "@/lib/study/reports-service";

export const dynamic = "force-dynamic";
const bodySchema = z.object({ kind: z.enum(["week", "month"]), expectedRevision: z.number().int().positive(), rangeStart: z.string().datetime(), rangeEnd: z.string().datetime() });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const current = await getPeriodicReport(parsed.data.kind, new Date(), user.id);
    if (current.id !== id) {
      throw new ApiError("PERIODIC_REPORT_REVISION_CONFLICT", 409, {
        latest: { kind: "periodic-report-decision", report: current, decision: current.decision },
        conflictFields: ["id", "revision"],
        workbench: "/review/reports",
      });
    }
    const decision = await decidePeriodicReport({ ...parsed.data, action: "reject" }, user.id);
    return NextResponse.json({ decision, stageDraftId: decision.stageDraftId, inboxResult: decision.inboxResult }, { status: decision.alreadyDecided ? 200 : 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
