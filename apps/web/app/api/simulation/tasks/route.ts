import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { ApiError, apiErrorResponse } from "@/lib/api/responses";
import { listSimulationTasks } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ tasks: await listSimulationTasks(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireApiUser(request);
    throw new ApiError("LEGACY_SIMULATION_TASK_WRITE_DISABLED", 410);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
