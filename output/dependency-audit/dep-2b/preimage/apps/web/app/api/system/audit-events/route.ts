import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { listAuditEvents } from "@/lib/system/audit-search-service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  workspaceId: z.string().trim().min(1).max(191).optional(),
  actorId: z.string().trim().min(1).max(191).optional(),
  actionPrefix: z.string().trim().min(1).max(80).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ events: await listAuditEvents(actor, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
