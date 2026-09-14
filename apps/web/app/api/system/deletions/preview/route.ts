import type { NextRequest } from "next/server";
import { readJson, requireApiUser, requireRecentReauthentication } from "@/lib/api/auth";
import { zodErrorResponse } from "@/lib/api/responses";
import { previewUserDeletion } from "@/lib/system/data-deletion-service";
import { deletionTargetSchema, deletionErrorResponse, deletionJson } from "@/lib/system/data-deletion-route";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request); await requireRecentReauthentication(user);
    const parsed = deletionTargetSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return deletionJson({ preview: await previewUserDeletion(user, parsed.data) });
  } catch (error) { return deletionErrorResponse(error); }
}
