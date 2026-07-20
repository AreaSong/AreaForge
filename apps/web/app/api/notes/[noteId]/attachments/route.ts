import { NextRequest, NextResponse } from "next/server";
import { BoundedMultipartError, createUploadPolicy, parseAllowedUploadMimeTypes, parseSingleFileMultipart } from "@areaforge/storage";
import { requireApiUser } from "@/lib/api/auth";
import { ApiError, apiErrorResponse } from "@/lib/api/responses";
import { getAuthEnv } from "@/lib/auth/env";
import { createNoteAttachment } from "@/lib/study/attachments-service";

export const dynamic = "force-dynamic";

// multipart 边界、字段头和转义的额外余量；正文超限由有界流式 parser 按实际字节精确中止。
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

    if (!request.body) {
      throw new ApiError("ATTACHMENT_FILE_REQUIRED", 400);
    }

    const env = getAuthEnv();
    const policy = createUploadPolicy(env.MAX_UPLOAD_MB, parseAllowedUploadMimeTypes(env.ALLOWED_UPLOAD_MIME));
    let scan;
    try {
      scan = await parseSingleFileMultipart(
        streamToAsyncIterable(request.body),
        request.headers.get("content-type"),
        policy,
      );
    } catch (error) {
      throw multipartErrorToApiError(error);
    }

    const attachment = await createNoteAttachment({ noteId, scan }, user.id);
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

async function* streamToAsyncIterable(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function multipartErrorToApiError(error: unknown): ApiError {
  if (error instanceof BoundedMultipartError) {
    switch (error.reason) {
      case "too_large":
        return new ApiError("ATTACHMENT_TOO_LARGE", 413);
      case "multiple_files":
        return new ApiError("ATTACHMENT_MULTIPLE_FILES", 400);
      case "file_part_missing":
        return new ApiError("ATTACHMENT_FILE_REQUIRED", 400);
      default:
        return new ApiError("ATTACHMENT_BAD_MULTIPART", 400);
    }
  }
  return error instanceof ApiError ? error : new ApiError("ATTACHMENT_BAD_MULTIPART", 400);
}
