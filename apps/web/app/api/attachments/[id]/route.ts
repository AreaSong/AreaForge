import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { ApiError, apiErrorResponse } from "@/lib/api/responses";
import { getAttachmentDownload } from "@/lib/study/attachments-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser(request);
    const { id } = await context.params;
    const disposition = parseDisposition(request.nextUrl.searchParams.get("disposition"));
    const download = await getAttachmentDownload(id, disposition);
    return new NextResponse(toArrayBuffer(download.bytes), { headers: download.headers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function parseDisposition(value: string | null): "attachment" | "inline" {
  if (!value || value === "attachment") return "attachment";
  if (value === "inline") return "inline";
  throw new ApiError("ATTACHMENT_INVALID_DISPOSITION", 400);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}
