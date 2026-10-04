import { z } from "zod";
import { prisma, operationHash } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { CurrentUser } from "@/lib/auth/session";
import { requirePlatformOperator } from "./operator-policy";

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const projectionSchema = z.object({
  requestHash: hash, rawEventHash: hash, projectionHash: hash,
  phase: z.enum(["admission", "validation", "backup", "prepare", "migration", "switch", "health", "smoke", "rollback", "maintenance", "preview", "check", "execution", "terminal", "writeback", "reconciliation"]),
  state: z.enum(["started", "complete", "uncertain"]), executionAttempted: z.boolean(),
  environment: z.enum(["local_fixture", "production"]), generation: z.number().int().positive(),
}).strict();

export async function listControlledOperationEvidence(actor: CurrentUser, requestId: string) {
  await requirePlatformOperator(actor);
  const request = await prisma.controlledOperationRequest.findUnique({ where: { id: requestId }, select: { requestHash: true } });
  if (!request) throw new ApiError("CONTROLLED_OPERATION_NOT_FOUND", 404);
  const records = await prisma.auditEvent.findMany({ where: { entityType: "ControlledOperationRequest", entityId: requestId, action: "CONTROLLED_OPERATION_ROOT_PHASE" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 256 });
  return records.map(record => {
    const parsed = projectionSchema.safeParse(record.metadata);
    if (!parsed.success || parsed.data.requestHash !== request.requestHash) throw new ApiError("CONTROLLED_OPERATION_EVIDENCE_INVALID", 409);
    const { projectionHash, requestHash, rawEventHash, phase, state, executionAttempted, environment } = parsed.data;
    const data = { requestHash, rawEventHash, phase, state, executionAttempted, environment };
    if (operationHash({ domain: "areaforge.controlled-operation.projection.v2", ...data }) !== projectionHash) throw new ApiError("CONTROLLED_OPERATION_EVIDENCE_INVALID", 409);
    return { ...data, projectionHash, recordedAt: record.createdAt.toISOString() };
  });
}
