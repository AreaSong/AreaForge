import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { ApiError, apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { updateMistakeSchema } from "@/lib/study/schemas";
import { getOwnedMistakeDetail, updateMistake } from "@/lib/study/mistakes-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const detail = await getOwnedMistakeDetail(id, user.id);
    if (!detail) throw new ApiError("MISTAKE_NOT_FOUND", 404);
    return NextResponse.json({ mistake: detail.mistake });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = updateMistakeSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({ mistake: await updateMistake(id, parsed.data, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
