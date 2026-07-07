import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { startManualRecoveryStateSchema } from "@/lib/study/schemas";
import { startManualRecoveryState } from "@/lib/study/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = startManualRecoveryStateSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({ recoveryState: await startManualRecoveryState(parsed.data, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
