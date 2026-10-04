import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { archiveMotivationItemSchema } from "@/lib/study/schemas";
import { archiveMotivationItem } from "@/lib/study/motivation-library-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { itemId } = await context.params;
    const parsed = archiveMotivationItemSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      item: await archiveMotivationItem(user.id, itemId, parsed.data.expectedRevision),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
