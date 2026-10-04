import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api/auth";
import { zodErrorResponse } from "@/lib/api/responses";
import { getUserDeletionCandidates } from "@/lib/system/data-deletion-service";
import { deletionErrorResponse, deletionJson } from "@/lib/system/data-deletion-route";
export const dynamic = "force-dynamic";
const candidatesSchema = z.object({ workspaceId: z.string().min(1).max(200), resourceType: z.enum(["Note", "Mistake", "StudyTask", "StudyResource", "KnowledgePoint"]), query: z.string().max(100).optional() }).strict();
export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = candidatesSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return deletionJson({ candidates: await getUserDeletionCandidates(user, parsed.data.workspaceId, parsed.data.resourceType, parsed.data.query) });
  } catch (error) { return deletionErrorResponse(error); }
}
