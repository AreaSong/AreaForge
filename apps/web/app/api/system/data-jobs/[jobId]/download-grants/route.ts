import { NextRequest, NextResponse } from "next/server";
import { readJson, requireApiUser, requireRecentReauthentication } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  createExportDownloadGrant,
  revokeExportDownloadGrants,
} from "@/lib/system/data-lifecycle-service";
import { z } from "zod";

export const dynamic = "force-dynamic";
const emptyBodySchema = z.object({}).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = emptyBodySchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    await requireRecentReauthentication(actor);
    const { jobId } = await context.params;
    return NextResponse.json({ grant: await createExportDownloadGrant(actor, jobId) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const actor = await requireApiUser(request);
    await requireRecentReauthentication(actor);
    const { jobId } = await context.params;
    return NextResponse.json(await revokeExportDownloadGrants(actor, jobId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
