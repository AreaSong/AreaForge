import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { subjectMergeUndoSchema } from "@/lib/study/subject-merge-command";
import { undoWorkspaceSubjectMerge } from "@/lib/study/subject-merge-undo-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; mergeId: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id, mergeId } = await context.params;
    const parsed = subjectMergeUndoSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      undo: await undoWorkspaceSubjectMerge(user.id, {
        workspaceId: id,
        operationId: mergeId,
        ...parsed.data,
      }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
