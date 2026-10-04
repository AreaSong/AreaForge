import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { requirePlatformOperator } from "@/lib/system/operator-policy";
import { listControlledOperations } from "@/lib/system/controlled-operation";
import { readOperationExecutionContext } from "@/lib/system/controlled-operation-context";
import { operationExpectedBeforeHash } from "@areaforge/db";

export const dynamic = "force-dynamic";

/**
 * 只读返回 operation catalog；此 route 不接受 intent，也不触发 agent/updater。
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    await requirePlatformOperator(actor);
    const context = await readOperationExecutionContext().catch(() => undefined);
    return NextResponse.json({ operations: listControlledOperations(), executionStatus: context === undefined ? "unavailable" : context ? "ready" : "disabled",
      executionContext: context ? {
        snapshotHash: context.snapshotHash, expectedBeforeHash: operationExpectedBeforeHash(context.expectedBefore),
        environment: context.environment, observedAt: context.observedAt, currentVersion: context.expectedBefore.currentVersion,
        currentImage: context.expectedBefore.currentImage, targetVersion: context.target?.manifestVersion ?? null,
        targetImage: context.target?.webImageDigest ?? null, rollbackTargetVersion: context.expectedBefore.rollbackTargetVersion,
        rollbackTargetImage: context.expectedBefore.rollbackTargetImage, signatureRequired: context.expectedBefore.signatureRequired,
      } : null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
