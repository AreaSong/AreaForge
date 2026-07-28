import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { getMotivationNext } from "@/lib/study/motivation-library-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = (await readJson(request).catch(() => ({}))) as {
      mode?: "manual" | "automatic";
      recordReminder?: boolean;
    };
    const mode = body.mode === "automatic" || body.recordReminder ? "automatic" : "manual";
    return NextResponse.json(
      await getMotivationNext(user.id, { mode }),
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
