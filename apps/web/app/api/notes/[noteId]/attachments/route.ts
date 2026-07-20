import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { ApiError, apiErrorResponse } from "@/lib/api/responses";
import { getAuthEnv } from "@/lib/auth/env";
import { createNoteAttachment } from "@/lib/study/attachments-service";

export const dynamic = "force-dynamic";

// multipart 边界、字段头和转义的额外余量；正文超限仍由存储策略精确校验。
const multipartOverheadBytes = 64 * 1024;

function assertDeclaredContentLengthWithinPolicy(request: NextRequest): void {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (!Number.isFinite(declared)) return;
  const maxBodyBytes = getAuthEnv().MAX_UPLOAD_MB * 1024 * 1024 + multipartOverheadBytes;
  if (declared > maxBodyBytes) {
    throw new ApiError("ATTACHMENT_TOO_LARGE", 413);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ noteId: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { noteId } = await context.params;
    assertDeclaredContentLengthWithinPolicy(request);
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
