import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { rejectWorkspaceInvitation } from "@/lib/workspace/membership-service";

export const dynamic = "force-dynamic";
const schema = z.object({ token: z.string().min(32).max(256) });

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const actor = await requireApiUser(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    await rejectWorkspaceInvitation(actor, parsed.data.token);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
