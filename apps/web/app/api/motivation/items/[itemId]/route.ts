import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { updateMotivationItemSchema } from "@/lib/study/schemas";
import { updateMotivationItem } from "@/lib/study/motivation-library-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { itemId } = await context.params;
    const parsed = updateMotivationItemSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ item: await updateMotivationItem(user.id, itemId, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
