import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { archiveNote } from "@/lib/study/notes-service";
import { noteRevisionCommandSchema } from "@/lib/study/schemas";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ noteId: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { noteId } = await context.params;
    const parsed = noteRevisionCommandSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ note: await archiveNote(noteId, parsed.data.expectedRevision, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
