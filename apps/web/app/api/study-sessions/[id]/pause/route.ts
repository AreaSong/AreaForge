import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { pauseStudySession } from "@/lib/study/session-lifecycle-service";
import { sessionCommandSchema } from "@/lib/study/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = sessionCommandSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ session: await pauseStudySession(id, user.id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
