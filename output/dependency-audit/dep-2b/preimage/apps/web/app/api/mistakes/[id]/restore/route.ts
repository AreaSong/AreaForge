import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { mistakeArchiveCommandSchema } from "@/lib/study/schemas";
import { restoreMistake } from "@/lib/study/mistakes-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = mistakeArchiveCommandSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({
      mistake: await restoreMistake(id, parsed.data.expectedUpdatedAt, user.id),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
