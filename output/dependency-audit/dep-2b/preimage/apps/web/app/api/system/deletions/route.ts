import type { NextRequest } from "next/server";
import { readJson, requireApiUser, requireRecentReauthentication } from "@/lib/api/auth";
import { zodErrorResponse } from "@/lib/api/responses";
import { createUserDeletion, listUserDeletions } from "@/lib/system/data-deletion-service";
import { deletionCreateSchema, deletionErrorResponse, deletionJson } from "@/lib/system/data-deletion-route";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { return deletionJson({ intents: await listUserDeletions(await requireApiUser(request)) }); }
  catch (error) { return deletionErrorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request); await requireRecentReauthentication(user);
    const parsed = deletionCreateSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return deletionJson({ intent: await createUserDeletion(user, parsed.data) });
  } catch (error) { return deletionErrorResponse(error); }
}
