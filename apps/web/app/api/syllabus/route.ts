import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { listSyllabusTree } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    return NextResponse.json({ nodes: await listSyllabusTree() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
