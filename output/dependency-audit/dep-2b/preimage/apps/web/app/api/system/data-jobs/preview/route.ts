import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser, requireRecentReauthentication } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { previewDataLifecycle } from "@/lib/system/data-lifecycle-service";

export const dynamic = "force-dynamic";

const previewSchema = z.object({
  kind: z.enum(["EXPORT", "DELETE"]),
  scope: z.enum(["ACCOUNT", "WORKSPACE"]),
  workspaceId: z.string().trim().min(1).max(120).optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const parsed = previewSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    await requireRecentReauthentication(actor);
    return NextResponse.json({ preview: await previewDataLifecycle(actor, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
