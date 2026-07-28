import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { ApiError, apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { confirmLearningTreeImport } from "@/lib/study/learning-tree-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  markdown: z.string().min(1).max(2 * 1024 * 1024),
  previewToken: z.string().min(1),
  idempotencyKey: z.string().trim().min(8).max(120),
  previewOperationId: z.string().uuid().optional(),
  selections: z
    .array(
      z.object({
        stableKey: z.string().min(1).max(120),
        choice: z.enum(["apply", "skip"]),
        mappedTargetId: z.string().min(1).max(120).optional(),
      }).strict(),
    )
    .max(5000),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json(
      { result: await confirmLearningTreeImport(user.id, parsed.data) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(completeConfirmConflictContract(error));
  }
}

function completeConfirmConflictContract(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.status !== 409) return error;
  return new ApiError(error.code, 409, {
    latest: error.details?.latest ?? { state: "CONFLICT" },
    conflictFields: error.details?.conflictFields?.length
      ? error.details.conflictFields
      : ["confirmState"],
    workbench: "/knowledge/imports",
  });
}
