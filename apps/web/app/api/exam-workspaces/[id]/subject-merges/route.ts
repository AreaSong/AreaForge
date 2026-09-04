import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { subjectMergeConfirmSchema } from "@/lib/study/subject-merge-command";
import { mergeWorkspaceSubjects } from "@/lib/study/subject-merge-service";
import { listRecentSubjectMergeOperations } from "@/lib/study/subject-merge-undo-service";
import { listSubjectDuplicatePreviews } from "@/lib/study/subject-duplicate-query-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const [duplicateSets, mergeOperations] = await Promise.all([
      listSubjectDuplicatePreviews(user.id, id),
      listRecentSubjectMergeOperations(user.id, id),
    ]);
    return NextResponse.json({ duplicateSets, mergeOperations });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = subjectMergeConfirmSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({
      merge: await mergeWorkspaceSubjects(user.id, {
        workspaceId: id,
        ...parsed.data,
      }),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
