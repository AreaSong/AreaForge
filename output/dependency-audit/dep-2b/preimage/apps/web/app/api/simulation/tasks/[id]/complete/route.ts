import { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { ApiError, apiErrorResponse } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireApiUser(request);
    throw new ApiError("LEGACY_SIMULATION_TASK_WRITE_DISABLED", 410);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
