import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { requirePlatformOperator } from "@/lib/system/operator-policy";
import { completeDataLifecycleJob } from "@/lib/system/data-lifecycle-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  jobId: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
  workerId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,120}$/),
  expectedRevision: z.number().int().nonnegative(),
  outcome: z.enum(["SUCCEEDED", "FAILED", "CANCELLED", "PAUSED"]),
  errorCode: z.string().trim().regex(/^[A-Z0-9_.:-]{1,80}$/).optional(),
  retryable: z.boolean().optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    await requirePlatformOperator(actor);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ job: await completeDataLifecycleJob(parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
