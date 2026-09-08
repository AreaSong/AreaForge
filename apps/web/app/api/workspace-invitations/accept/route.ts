import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createUserSession, getCurrentUserFromRequest, setSessionCookie } from "@/lib/auth/session";
import { acceptWorkspaceInvitation } from "@/lib/workspace/membership-service";

export const dynamic = "force-dynamic";
const schema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(256).optional(),
});

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const actor = await getCurrentUserFromRequest(request);
    const accepted = await acceptWorkspaceInvitation({ ...parsed.data, actor });
    const response = NextResponse.json({
      workspaceId: accepted.workspaceId,
      createdAccount: accepted.createdAccount,
    });
    if (accepted.createdAccount) {
      setSessionCookie(response, await createUserSession(request, accepted.user));
    }
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
