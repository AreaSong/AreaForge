import { prisma } from "@areaforge/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { clearSessionCookie, deleteCurrentSession, getCurrentUserFromRequest } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await getCurrentUserFromRequest(request);
    await deleteCurrentSession(request);

    if (user) {
      await prisma.auditEvent.create({
        data: {
          actorId: user.id,
          action: "AUTH_LOGOUT",
          entityType: "User",
          entityId: user.id,
        },
      });
    }

    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
