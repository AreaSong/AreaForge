import type { NextRequest } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser, requireRecentReauthentication } from "@/lib/api/auth";
import { zodErrorResponse } from "@/lib/api/responses";
import { controlUserDeletion } from "@/lib/system/data-deletion-service";
import { deletionErrorResponse, deletionJson } from "@/lib/system/data-deletion-route";
export const dynamic = "force-dynamic";
const controlSchema = z.object({ action: z.enum(["cancel", "restore", "retry"]), expectedRevision: z.number().int().positive() }).strict();
export async function PATCH(request: NextRequest, context: { params: Promise<{ intentId: string }> }) {
  try {
    const user = await requireApiUser(request); await requireRecentReauthentication(user);
    const parsed = controlSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return deletionJson({ intent: await controlUserDeletion(user, (await context.params).intentId, parsed.data) });
  } catch (error) { return deletionErrorResponse(error); }
}
