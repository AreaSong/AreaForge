import { prisma } from "@areaforge/db";
import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, deleteCurrentSession, getCurrentUserFromRequest } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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
}
