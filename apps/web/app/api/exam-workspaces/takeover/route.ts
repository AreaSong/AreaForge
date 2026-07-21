import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { applyWorkspaceTakeover, previewWorkspaceTakeover } from "@/lib/study/exam-workspace-service";

export const dynamic = "force-dynamic";

const applySchema = z.object({
  workspaceId: z.string().min(1),
  subjectIds: z.array(z.string().min(1)).max(100),
  expectedRevision: z.number().int().positive(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ preview: await previewWorkspaceTakeover(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = applySchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json(await applyWorkspaceTakeover(user.id, parsed.data));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
