import { NextRequest, NextResponse } from "next/server";
import { BoundedMultipartError } from "@areaforge/storage";
import { requireApiUser } from "@/lib/api/auth";
import { ApiError, apiErrorResponse } from "@/lib/api/responses";
import {
  createStudyResourceUploadPolicy,
  parseMultipleFilesMultipart,
  stageStudyResourceUploadBatch,
  listStagedStudyResourceUploads,
  STUDY_RESOURCE_MAX_FILES_PER_BATCH,
} from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";

const multipartOverheadBytes = 64 * 1024;

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const items = await listStagedStudyResourceUploads(user.id);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new ApiError("INVALID_IDEMPOTENCY_KEY", 400);
    const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
    const policy = createStudyResourceUploadPolicy();
    if (
      Number.isFinite(declared) &&
      declared > policy.maxBytes * STUDY_RESOURCE_MAX_FILES_PER_BATCH + multipartOverheadBytes
    ) {
      throw new ApiError("ATTACHMENT_TOO_LARGE", 413);
    }
    if (!request.body) throw new ApiError("ATTACHMENT_FILE_REQUIRED", 400);
    const scans = await parseMultipleFilesMultipart(
      streamToAsyncIterable(request.body),
      request.headers.get("content-type"),
      policy,
      STUDY_RESOURCE_MAX_FILES_PER_BATCH,
    );
    const items = await stageStudyResourceUploadBatch(user.id, scans, idempotencyKey);
    return NextResponse.json({ items }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(toUploadApiError(error));
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

function toUploadApiError(error: unknown): unknown {
  if (!(error instanceof BoundedMultipartError)) return error;
  switch (error.reason) {
    case "too_large":
      return new ApiError("ATTACHMENT_TOO_LARGE", 413);
    case "multiple_files":
      return new ApiError("ATTACHMENT_MULTIPLE_FILES", 400);
    case "too_many_files":
      return new ApiError("STUDY_RESOURCE_BATCH_LIMIT", 400);
    case "file_part_missing":
      return new ApiError("ATTACHMENT_FILE_REQUIRED", 400);
    default:
      return new ApiError("ATTACHMENT_BAD_MULTIPART", 400);
  }
}
