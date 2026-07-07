import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { ApiError, apiErrorResponse } from "@/lib/api/responses";
import { createNoteAttachment } from "@/lib/study/attachments-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ noteId: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { noteId } = await context.params;
    const formData = await request.formData().catch(() => {
      throw new ApiError("ATTACHMENT_BAD_MULTIPART", 400);
    });
    const files = formData.getAll("file");

    if (files.length === 0) {
      throw new ApiError("ATTACHMENT_FILE_REQUIRED", 400);
    }
    if (files.length > 1) {
      throw new ApiError("ATTACHMENT_MULTIPLE_FILES", 400);
    }

    const file = files[0];
    if (!(file instanceof File)) {
      throw new ApiError("ATTACHMENT_FILE_REQUIRED", 400);
    }

    const attachment = await createNoteAttachment({ noteId, file }, user.id);
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
