import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { updateWorkspaceMemberRole } from "@/lib/workspace/rbac-service";

export const dynamic = "force-dynamic";

const roleUpdateSchema = z.object({
  role: z.enum(["ADMIN", "COACH", "MEMBER", "VIEWER"]),
  expectedRevision: z.number().int().positive(),
}).strict();

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; membershipId: string }> },
) {
  try {
    const actor = await requireApiUser(request);
    const parsed = roleUpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id, membershipId } = await context.params;
    return NextResponse.json({
      membership: await updateWorkspaceMemberRole(
        actor,
        id,
        membershipId,
        parsed.data.role,
        parsed.data.expectedRevision,
      ),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
