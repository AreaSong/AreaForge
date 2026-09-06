import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  revokeWorkspaceShareGrant,
  updateWorkspaceShareGrant,
} from "@/lib/workspace/share-grant-service";

export const dynamic = "force-dynamic";

const updateGrantSchema = z.object({
  expectedRevision: z.number().int().positive(),
  access: z.enum(["VIEW", "COACH"]).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict().refine((value) => value.access !== undefined || value.expiresAt !== undefined, {
  message: "access or expiresAt is required",
});

const revokeGrantSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; grantId: string }> },
) {
  try {
    const actor = await requireApiUser(request);
    const parsed = updateGrantSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id, grantId } = await context.params;
    const grant = await updateWorkspaceShareGrant(actor.id, id, grantId, {
      ...parsed.data,
      expiresAt: parsed.data.expiresAt === undefined
        ? undefined
        : parsed.data.expiresAt === null ? null : new Date(parsed.data.expiresAt),
    });
    return NextResponse.json({ grant });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; grantId: string }> },
) {
  try {
    const actor = await requireApiUser(request);
    const parsed = revokeGrantSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id, grantId } = await context.params;
    return NextResponse.json({
      grant: await revokeWorkspaceShareGrant(actor.id, id, grantId, parsed.data.expectedRevision),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
