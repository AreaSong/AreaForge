import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { ApiError, apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createUpdateRequest } from "@/lib/system/update-center";
import {
  updateRequestCommandSchema,
  UpdateRequestV2Error,
  type UpdateRequestV2ErrorCode,
} from "@/lib/system/update-request-v2";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = updateRequestCommandSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    const updateRequest = await createUpdateRequest({
      command: parsed.data,
      actorEmail: user.email,
    });
    return NextResponse.json({ request: updateRequest }, { status: 202 });
  } catch (error) {
    if (error instanceof UpdateRequestV2Error) {
      return apiErrorResponse(new ApiError(error.code, statusForV2Error(error.code)));
    }
    return apiErrorResponse(error);
  }
}

function statusForV2Error(code: UpdateRequestV2ErrorCode): number {
  return code === "STATUS_SNAPSHOT_INVALID" ? 503 : 409;
}
