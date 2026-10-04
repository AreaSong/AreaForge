import { NextRequest, NextResponse } from "next/server";
import { readJson, requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { controlSearchIndex, searchIndexControlSchema } from "@/lib/system/workspace-search-index-service";

export const dynamic = "force-dynamic";
export async function PATCH(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const actor = await requireApiUser(request); const parsed = searchIndexControlSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { jobId } = await context.params;
    return NextResponse.json({ job: await controlSearchIndex(actor, jobId, parsed.data) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
