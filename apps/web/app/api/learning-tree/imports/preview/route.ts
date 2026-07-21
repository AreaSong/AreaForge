import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { previewLearningTreeImport } from "@/lib/study/learning-tree-service";

export const dynamic = "force-dynamic";

const previewSchema = z.object({
  markdown: z.string().min(1).max(2 * 1024 * 1024),
  scope: z.enum(["global", "subject", "branch"]).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = previewSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const preview = await previewLearningTreeImport(user.id, parsed.data);
    return NextResponse.json({ preview });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
