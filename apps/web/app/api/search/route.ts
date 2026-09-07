import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { searchWorkspace } from "@/lib/system/workspace-search-service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  workspaceId: z.string().trim().min(1).max(191),
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ search: await searchWorkspace(actor.id, parsed.data.workspaceId, parsed.data.q, parsed.data.limit) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
