import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { reorderMotivationItemsSchema } from "@/lib/study/schemas";
import { reorderMotivationItems } from "@/lib/study/motivation-library-service";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = reorderMotivationItemsSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ items: await reorderMotivationItems(user.id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
