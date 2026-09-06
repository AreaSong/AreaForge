import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { requirePlatformOperator } from "@/lib/system/operator-policy";
import { claimDataLifecycleJob } from "@/lib/system/data-lifecycle-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  jobId: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/).optional(),
  workerId: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,120}$/),
  leaseExpiresAt: z.string().datetime({ offset: true }),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    await requirePlatformOperator(actor);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const lease = await claimDataLifecycleJob({
      ...parsed.data,
      leaseExpiresAt: new Date(parsed.data.leaseExpiresAt),
    });
    return NextResponse.json({ lease }, { status: 200 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
