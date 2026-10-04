import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { ApiError, apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { getOwnedNoteDetail, updateNote } from "@/lib/study/notes-service";
import { updateNoteSchema } from "@/lib/study/schemas";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ noteId: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { noteId } = await context.params;
    const detail = await getOwnedNoteDetail(noteId, user.id);
    if (!detail) throw new ApiError("NOTE_NOT_FOUND", 404);
    return NextResponse.json({
      note: detail.note,
      readOnly: detail.readOnly,
      subjectArchived: detail.subjectArchived,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ noteId: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { noteId } = await context.params;
    const parsed = updateNoteSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ note: await updateNote(noteId, parsed.data, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
