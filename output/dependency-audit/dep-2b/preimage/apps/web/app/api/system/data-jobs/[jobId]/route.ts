import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser, requireRecentReauthentication } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  cancelDataLifecycleJob,
  getDataLifecycleJob,
  retryDataLifecycleJob,
  pauseDataLifecycleJob,
  resumeDataLifecycleJob,
} from "@/lib/system/data-lifecycle-service";

export const dynamic = "force-dynamic";

const mutationSchema = z.object({
  action: z.enum(["cancel", "retry", "pause", "resume"]),
  expectedRevision: z.number().int().nonnegative(),
}).strict();

export async function GET(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const { jobId } = await context.params;
    return NextResponse.json({ job: await getDataLifecycleJob(actor, jobId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = mutationSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    await requireRecentReauthentication(actor);
    const { jobId } = await context.params;
    const actions = { cancel: cancelDataLifecycleJob, retry: retryDataLifecycleJob, pause: pauseDataLifecycleJob, resume: resumeDataLifecycleJob };
    const job = await actions[parsed.data.action](actor, jobId, parsed.data.expectedRevision);
    return NextResponse.json({ job });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
