import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser, requireRecentReauthentication } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  listDataLifecycleJobs,
  normalizeDataLifecycleRequest,
  requestDataLifecycleJob,
} from "@/lib/system/data-lifecycle-service";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  kind: z.enum(["EXPORT", "DELETE"]),
  scope: z.enum(["ACCOUNT", "WORKSPACE"]),
  workspaceId: z.string().trim().min(1).max(120).optional(),
  idempotencyKey: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    return NextResponse.json({ jobs: await listDataLifecycleJobs(actor) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const parsed = requestSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    // Keep a route-level re-auth check for a clear boundary; the service
    // repeats it inside its transaction to fence TOCTOU races.
    await requireRecentReauthentication(actor);
    const normalized = normalizeDataLifecycleRequest(parsed.data);
    return NextResponse.json({ job: await requestDataLifecycleJob(actor, normalized) }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
