import { randomBytes } from "node:crypto";
import { DATA_DELETE_COOLDOWN_MS, DATA_TRASH_RETENTION_MS, DataDeleteError, hashDataExportValue, type PersistedDeletionLedger } from "@areaforge/core";
import { type PrismaClient } from "../generated/prisma/client";
import { buildRestorationDeletePlan } from "./data-delete-plan";
import { DELETE_FENCE_LOCK, deleteClock } from "./data-delete-intents";
import { DATA_DELETE_LEASE_MS, type DataDeleteLease } from "./data-delete-lease";

/** 只在外部 head 已校验且恢复副本未对外提供服务时调用；原 ledger 保留在独立可信源。 */
export async function prepareDeletionReplay(client: PrismaClient, entry: PersistedDeletionLedger, databaseName: string): Promise<DataDeleteLease | null> {
  if (entry.manifest.protocol !== "data-delete-ledger-v2" || !entry.manifest.target) throw new DataDeleteError("DATA_DELETE_LEGACY_LEDGER_REPLAY_UNSUPPORTED");
  const target = entry.manifest.target;
  const replayId = "replay_" + entry.intentId;
  const requestHash = hashDataExportValue({ sourceEntryHash: entry.entryHash, databaseName });
  return client.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DELETE_FENCE_LOCK})`;
    const existing = await tx.dataDeletionIntent.findUnique({ where: { id: replayId } });
    const now = await deleteClock(tx);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new DataDeleteError("DATA_DELETE_REPLAY_BINDING_CHANGED");
      if (existing.state === "SUCCEEDED") return null;
      if (existing.state === "RUNNING" && existing.leaseExpiresAt && existing.leaseExpiresAt > now) throw new DataDeleteError("DATA_DELETE_REPLAY_BUSY", true);
      const resumed = await tx.dataDeletionIntent.update({ where: { id: replayId }, data: { state: "RUNNING", leaseOwner: "restore-ledger",
        leaseVersion: { increment: 1 }, leaseExpiresAt: new Date(now.getTime() + DATA_DELETE_LEASE_MS), attempt: { increment: 1 }, revision: { increment: 1 } } });
      return { intentId: replayId, workerId: "restore-ledger", version: resumed.leaseVersion };
    }
    const plan = await buildRestorationDeletePlan(tx, target);
    if (plan.blockers.length || !plan.items.length) throw new DataDeleteError("DATA_DELETE_RESTORE_SCOPE_BLOCKED");
    const identities = plan.items.map(item => item.identityHash);
    const oldFences = await tx.dataDeletionFence.findMany({ where: { identityHash: { in: identities } }, select: { intentId: true } });
    const oldIntentIds = [...new Set(oldFences.map(row => row.intentId))];
    if (oldIntentIds.length) {
      if (await tx.dataDeletionIntent.count({ where: { id: { in: oldIntentIds }, requesterId: { not: target.requesterId } } })) throw new DataDeleteError("DATA_DELETE_RESTORE_SCOPE_BLOCKED");
      await tx.dataDeletionIntent.updateMany({ where: { id: { in: oldIntentIds } }, data: { state: "FAILED", errorCode: "DATA_DELETE_RESTORE_SUPERSEDED",
        leaseOwner: null, leaseExpiresAt: null, executionPid: null, revision: { increment: 1 } } });
      await tx.dataDeletionFence.deleteMany({ where: { identityHash: { in: identities } } });
    }
    const row = await tx.dataDeletionIntent.create({ data: { id: replayId, ...target, state: "RUNNING", idempotencyKey: replayId, requestHash,
      fingerprint: plan.fingerprint, authorizationHash: plan.authorizationHash, schemaHash: plan.schemaHash,
      frozenAt: new Date(now.getTime() - (target.scope === "RESOURCE" ? DATA_TRASH_RETENTION_MS : DATA_DELETE_COOLDOWN_MS)), availableAt: now,
      leaseOwner: "restore-ledger", leaseVersion: 1, attempt: 1, leaseExpiresAt: new Date(now.getTime() + DATA_DELETE_LEASE_MS),
      receiptTokenHash: randomBytes(32).toString("hex"), receiptExpiresAt: now } });
    for (let index = 0; index < plan.items.length; index += 500) {
      const batch = plan.items.slice(index, index + 500);
      await tx.dataDeletionItem.createMany({ data: batch.map(item => ({ intentId: row.id, model: item.model, keyJson: item.key, identityHash: item.identityHash, rowHash: item.rowHash })) });
      await tx.dataDeletionFence.createMany({ data: batch.map(item => ({ intentId: row.id, model: item.model, keyJson: item.key, identityHash: item.identityHash })) });
    }
    return { intentId: row.id, workerId: "restore-ledger", version: 1 };
  }, { timeout: 60_000 });
}
