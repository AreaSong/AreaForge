import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { ApiError, apiErrorResponse } from "@/lib/api/responses";
import { downloadStudyResource } from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const dispositionParam = request.nextUrl.searchParams.get("disposition");
    const disposition =
      dispositionParam === "inline" || dispositionParam === "attachment"
        ? dispositionParam
        : undefined;
    if (dispositionParam && !disposition) {
      throw new ApiError("ATTACHMENT_INVALID_DISPOSITION", 400);
    }
    const download = await downloadStudyResource(user.id, id, disposition);
    return new NextResponse(toArrayBuffer(download.bytes), { headers: download.headers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}
