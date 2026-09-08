import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  createWorkspaceShareGrant,
  listWorkspaceShareGrants,
} from "@/lib/workspace/share-grant-service";

export const dynamic = "force-dynamic";

const createGrantSchema = z.object({
  resourceType: z.enum(["NOTE", "MISTAKE", "ATTACHMENT"]),
  resourceId: z.string().trim().min(1).max(191),
  scope: z.enum(["USER", "ROLE", "WORKSPACE"]),
  granteeUserId: z.string().trim().min(1).max(191).nullable().optional(),
  granteeRole: z.enum(["OWNER", "ADMIN", "COACH", "MEMBER", "VIEWER"]).nullable().optional(),
  access: z.enum(["VIEW", "COACH"]),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const { id } = await context.params;
    return NextResponse.json({ grants: await listWorkspaceShareGrants(actor.id, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser(request);
    const parsed = createGrantSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const { id } = await context.params;
    const grant = await createWorkspaceShareGrant(actor.id, id, {
      ...parsed.data,
      expiresAt: parsed.data.expiresAt === undefined
        ? undefined
        : parsed.data.expiresAt === null ? null : new Date(parsed.data.expiresAt),
    });
    return NextResponse.json({ grant }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
