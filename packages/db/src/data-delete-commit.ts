import { DataDeleteError, hashDataExportValue, type DataDeleteTarget, type DataDeletePlan, type DataTrashResourceType } from "@areaforge/core";
import { Prisma, type DataDeletionIntent, type PrismaClient } from "../generated/prisma/client";
import { buildDatabaseDeletePlan } from "./data-delete-plan";
import { deleteModel, deleteRelations } from "./data-delete-models";
import { deleteKeyPredicate, quotedDeleteName, readDeleteRecords } from "./data-delete-query";
import { assertDeleteLease, lockedDeleteLease, renewDeleteLease, type DataDeleteLease } from "./data-delete-lease";
import { deleteClock, requireDataDeleteEnabled } from "./data-delete-intents";

export function deletionTarget(row: DataDeletionIntent): DataDeleteTarget {
  return { requesterId: row.requesterId, scope: row.scope as DataDeleteTarget["scope"], workspaceId: row.workspaceId,
    resourceType: row.resourceType as DataTrashResourceType | null, resourceId: row.resourceId };
}

export type DeletePlanBuilder = (tx: Prisma.TransactionClient, target: DataDeleteTarget, intentId?: string) => Promise<DataDeletePlan>;
export type DeletePlanVerifier = (tx: Prisma.TransactionClient, row: DataDeletionIntent) => Promise<DataDeletePlan>;
export async function verifyFrozenDeletePlan(tx: Prisma.TransactionClient, row: DataDeletionIntent, builder: DeletePlanBuilder = buildDatabaseDeletePlan) {
  const plan = await builder(tx, deletionTarget(row), row.id);
  if (plan.fingerprint !== row.fingerprint || plan.authorizationHash !== row.authorizationHash || plan.schemaHash !== row.schemaHash || plan.blockers.length) {
    throw new DataDeleteError("DATA_DELETE_FROZEN_SCOPE_CHANGED");
  }
  const persisted = await tx.dataDeletionItem.findMany({ where: { intentId: row.id } });
  const expected = new Map(plan.items.map(item => [item.identityHash, item]));
  if (persisted.length !== expected.size || persisted.some(item => {
    const source = expected.get(item.identityHash);
    return !source || source.rowHash !== item.rowHash || source.model !== item.model || hashDataExportValue(source.key) !== hashDataExportValue(item.keyJson);
  })) throw new DataDeleteError("DATA_DELETE_MANIFEST_CHANGED");
  const fences = await tx.dataDeletionFence.findMany({ where: { intentId: row.id } });
  if (fences.length !== expected.size || fences.some(item => {
    const source = expected.get(item.identityHash);
    return !source || source.model !== item.model || hashDataExportValue(source.key) !== hashDataExportValue(item.keyJson);
  })) throw new DataDeleteError("DATA_DELETE_FENCE_CHANGED");
  return plan;
}

export async function commitDatabaseDeletion(client: PrismaClient, lease: DataDeleteLease, afterSql?: () => Promise<void>, verifyPlan: DeletePlanVerifier = verifyFrozenDeletePlan, beforeCommit?: () => Promise<void>) {
  requireDataDeleteEnabled();
  return client.$transaction(async tx => {
    const initial = await lockedDeleteLease(tx, lease);
    if (!initial.irreversibleAt) throw new DataDeleteError("DATA_DELETE_IRREVERSIBLE_MARKER_REQUIRED");
    if (await tx.dataDeletionFile.count({ where: { intentId: initial.id, phase: { not: "REMOVED" } } })) throw new DataDeleteError("DATA_DELETE_FILES_PENDING");
    const row = await renewDeleteLease(tx, initial);
    const plan = await verifyPlan(tx, row);
    await tx.$executeRaw`SELECT set_config('areaforge.delete_intent', ${row.id}, true)`;
    const securityCleanupCounts: Record<string, number> = {};
    if (row.scope === "ACCOUNT") {
      // 可变登录安全状态使用计划内固定的本人谓词，在 User 行锁下统一撤销；不冻结登录/重新验证。
      securityCleanupCounts.AuthActionToken = await tx.$executeRaw`DELETE FROM "AuthActionToken" WHERE "userId"=${row.requesterId}`;
      securityCleanupCounts.AuthSession = await tx.$executeRaw`DELETE FROM "AuthSession" WHERE "userId"=${row.requesterId}`;
      securityCleanupCounts.AuthAuditEvent = await tx.$executeRaw`DELETE FROM "AuditEvent" WHERE "actorId"=${row.requesterId} AND left(action,5)='AUTH_'`;
    }
    const order = deletionModelOrder([...new Set(plan.items.map(item => item.model))]);
    for (const model of order) {
      const items = plan.items.filter(item => item.model === model);
      for (let offset = 0; offset < items.length; offset += 200) {
        const predicates = items.slice(offset, offset + 200).map(item => Prisma.sql`(${deleteKeyPredicate(item.key)})`);
        await tx.$executeRaw(Prisma.sql`DELETE FROM ${quotedDeleteName(model)} s WHERE ${Prisma.join(predicates, " OR ")}`);
      }
    }
    for (const item of plan.items) {
      if ((await readDeleteRecords(tx, item.model, deleteKeyPredicate(item.key))).length) throw new DataDeleteError("DATA_DELETE_RECORD_REMAINING");
    }
    await afterSql?.();
    assertDeleteLease(row, lease, await deleteClock(tx));
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(718420260914::bigint)`;
    const previous = await tx.dataDeletionLedger.findFirst({ orderBy: { sequence: "desc" }, select: { entryHash: true, sequence: true } });
    const completedAt = await deleteClock(tx);
    const files = await tx.dataDeletionFile.findMany({ where: { intentId: row.id }, orderBy: { identityHash: "asc" },
      select: { identityHash: true, storageKind: true, storageKey: true, expectedHash: true, expectedSize: true } });
    const manifest = { protocol: "data-delete-ledger-v2", target: { ...plan.target }, securityCleanup: plan.securityCleanup,
      securityOwnerId: row.scope === "ACCOUNT" ? row.requesterId : null, securityCleanupCounts,
      items: plan.items.map(item => ({ model: item.model, key: item.key, identityHash: item.identityHash })),
      files: files.map(file => ({ ...file, expectedSize: file.expectedSize === null ? null : Number(file.expectedSize) })) };
    const entryHash = hashDataExportValue({ intentId: row.id, scope: row.scope, scopeHash: row.fingerprint,
      previousHash: previous?.entryHash ?? null, completedAt: completedAt.toISOString(), manifest });
    await tx.dataDeletionLedger.create({ data: { sequence: (previous?.sequence ?? BigInt(0)) + BigInt(1), intentId: row.id, scope: row.scope, scopeHash: row.fingerprint,
      previousHash: previous?.entryHash ?? null, entryHash, completedAt, manifest: manifest as Prisma.InputJsonValue } });
    await tx.dataDeletionFence.deleteMany({ where: { intentId: row.id } });
    assertDeleteLease(row, lease, await deleteClock(tx));
    await tx.dataDeletionIntent.update({ where: { id: row.id }, data: { state: "SUCCEEDED", completedAt,
      revision: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, executionPid: null, errorCode: null,
      receiptExpiresAt: new Date(completedAt.getTime() + 3_600_000) } });
    await beforeCommit?.();
    assertDeleteLease(row, lease, await deleteClock(tx));
    return { intentId: row.id, state: "SUCCEEDED" as const, deletedObjects: plan.items.length, entryHash };
  }, { timeout: 60_000 });
}

/** 限制性外键先删子对象；CASCADE 的闭包已在预览和冻结重验中逐项证明。 */
export function deletionModelOrder(models: string[]): string[] {
  const pending = new Set(models); const order: string[] = [];
  const edges = deleteRelations().filter(edge => {
    const field = deleteModel(edge.child).fields.find(candidate => candidate.name === edge.name)!;
    return !["Cascade", "SetNull"].includes(field.relationOnDelete ?? "Restrict")
      || (edge.child === "StudyResource" && edge.parent === "Attachment");
  });
  while (pending.size) {
    const next = [...pending].sort().find(model => !edges.some(edge => edge.parent === model && edge.child !== model && pending.has(edge.child)));
    if (!next) throw new DataDeleteError("DATA_DELETE_DEPENDENCY_CYCLE");
    pending.delete(next); order.push(next);
  }
  return order;
}
