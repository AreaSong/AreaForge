import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { requirePlatformOperator } from "@/lib/system/operator-policy";
import { heartbeatDataLifecycleJob } from "@/lib/system/data-lifecycle-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  jobId: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
  workerId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,120}$/),
  expectedRevision: z.number().int().nonnegative(),
  leaseExpiresAt: z.string().datetime({ offset: true }),
  progress: z.number().finite().min(0).max(1),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    await requirePlatformOperator(actor);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ job: await heartbeatDataLifecycleJob({
      ...parsed.data,
      leaseExpiresAt: new Date(parsed.data.leaseExpiresAt),
    }) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
