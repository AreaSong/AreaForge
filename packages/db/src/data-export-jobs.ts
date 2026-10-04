import { DATA_EXPORT_JOB_PROTOCOL, DATA_EXPORT_POLICY_VERSION, DataExportError, assertDataExportJobBinding, dataExportJobFingerprint, type DataExportJobPayload } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { enqueueDataJobInTransaction } from "./data-job-queue";
import { queueClock } from "./data-job-queue-store";
import { exportDatabaseError, readDataExportAuthorization, assertDataExportAuthorization } from "./data-export-scope";

export function dataExportEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.DATA_LIFECYCLE_ENABLED === "true" && env.DATA_EXPORT_ENABLED === "true";
}
export function requireDataExportEnabled(env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (!dataExportEnabled(env)) throw new DataExportError("DATA_EXPORT_DISABLED");
}

export async function enqueueDataExportJob(tx: Prisma.TransactionClient, input: { requesterId: string; scope: "ACCOUNT" | "WORKSPACE"; workspaceId: string | null; idempotencyKey: string }) {
  requireDataExportEnabled();
  try {
    // 请求者锁使并发同键先后复用同一个服务端时间/TTL，不用重算赢家的 envelope。
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.requesterId} FOR UPDATE`;
    const existing = await tx.dataJob.findUnique({ where: { requestedByUserId_idempotencyKey: { requestedByUserId: input.requesterId, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      const payload = assertDataExportJobBinding(existing);
      if (payload.scope !== input.scope || payload.workspaceId !== input.workspaceId) throw new DataExportError("DATA_EXPORT_IDEMPOTENCY_CONFLICT");
      await assertDataExportAuthorization(tx, existing, true);
      requireDataExportEnabled();
      return existing;
    }
    const { authorization } = await readDataExportAuthorization(tx, input, true);
    const now = await queueClock(tx);
    const payload: DataExportJobPayload = { protocol: DATA_EXPORT_JOB_PROTOCOL, policyVersion: DATA_EXPORT_POLICY_VERSION,
      requesterId: input.requesterId, scope: input.scope, workspaceId: input.workspaceId, requestedAt: now.toISOString(), authorization };
    const job = await enqueueDataJobInTransaction(tx, { kind: "EXPORT", scope: input.scope, workspaceId: input.workspaceId,
      requestedByUserId: input.requesterId, idempotencyKey: input.idempotencyKey, requestFingerprint: dataExportJobFingerprint(payload),
      payloadJson: payload as unknown as Prisma.InputJsonValue, expiresAt: new Date(now.getTime() + 3_600_000) });
    requireDataExportEnabled();
    return job;
  } catch (error) { exportDatabaseError(error); }
}
