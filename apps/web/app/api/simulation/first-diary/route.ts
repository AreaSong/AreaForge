import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { saveFirstSimulationDiarySchema } from "@/lib/study/schemas";
import { saveFirstSimulationDiary } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = saveFirstSimulationDiarySchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({
      vault: await saveFirstSimulationDiary(parsed.data.firstSimulationDiary, user.id),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
