import { createHash, timingSafeEqual } from "node:crypto";
import { DATA_DELETE_COOLDOWN_MS, DATA_TRASH_RETENTION_MS, DataDeleteError, dataDeleteControlAllowed,
  deleteIdentifier, hashDataExportValue, type DataDeleteTarget, type DataDeleteState } from "@areaforge/core";
import { Prisma, type PrismaClient, type DataDeletionIntent } from "../generated/prisma/client";
import { buildDatabaseDeletePlan } from "./data-delete-plan";
import { quotedDeleteName } from "./data-delete-query";

export const DELETE_FENCE_LOCK = BigInt("718420260913");
export type DeleteActor = { id: string; sessionId: string };

export function requireDataDeleteEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (env.DATA_DELETE_ENABLED !== "true" || env.DATA_LIFECYCLE_ENABLED !== "true") throw new DataDeleteError("DATA_DELETE_DISABLED");
}

export async function requireDeleteActor(tx: Prisma.TransactionClient, actor: DeleteActor, now: Date) {
  deleteIdentifier(actor.id); deleteIdentifier(actor.sessionId);
  const session = await tx.authSession.findUnique({ where: { id: actor.sessionId }, include: { user: true } });
  if (!session || session.userId !== actor.id || session.user.status !== "ACTIVE" || session.revokedAt || session.expiresAt <= now
    || session.authRevision !== session.user.authRevision || !session.reauthenticatedAt
    || session.reauthenticatedAt > now || now.getTime() - session.reauthenticatedAt.getTime() > 15 * 60_000) {
    throw new DataDeleteError("DATA_DELETE_REAUTHENTICATION_REQUIRED");
  }
}

export async function previewDatabaseDeletion(client: PrismaClient, actor: DeleteActor, target: DataDeleteTarget) {
  requireDataDeleteEnabled();
  return client.$transaction(async tx => {
    await requireDeleteActor(tx, actor, await deleteClock(tx));
    if (actor.id !== target.requesterId) throw new DataDeleteError("DATA_DELETE_NOT_FOUND");
    const plan = await buildDatabaseDeletePlan(tx, target);
    let targetLabel = "我的账户";
    if (target.scope === "WORKSPACE") targetLabel = (await tx.examWorkspace.findUniqueOrThrow({ where: { id: target.workspaceId! }, select: { name: true } })).name;
    if (target.scope === "RESOURCE") {
      const [row] = await tx.$queryRaw<Array<{ title: string }>>(Prisma.sql`SELECT title FROM ${quotedDeleteName(target.resourceType!)} WHERE id=${target.resourceId}`);
      if (!row) throw new DataDeleteError("DATA_DELETE_NOT_FOUND"); targetLabel = row.title;
    }
    return { ...plan, targetLabel: targetLabel.slice(0, 200) };
  }, { isolationLevel: "RepeatableRead", timeout: 60_000 });
}

export async function createDatabaseDeletion(client: PrismaClient, input: {
  actor: DeleteActor; target: DataDeleteTarget; fingerprint: string; idempotencyKey: string; receiptToken: string;
}) {
  requireDataDeleteEnabled(); deleteIdentifier(input.idempotencyKey);
  if (!/^[a-f0-9]{64}$/.test(input.receiptToken)) throw new DataDeleteError("DATA_DELETE_RECEIPT_INVALID");
  const requestHash = hashDataExportValue({ target: input.target, fingerprint: input.fingerprint, receiptHash: receiptHash(input.receiptToken) });
  return client.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DELETE_FENCE_LOCK})`;
    const now = await deleteClock(tx); await requireDeleteActor(tx, input.actor, now);
    if (input.actor.id !== input.target.requesterId) throw new DataDeleteError("DATA_DELETE_NOT_FOUND");
    const existing = await tx.dataDeletionIntent.findUnique({ where: { requesterId_idempotencyKey: { requesterId: input.actor.id, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new DataDeleteError("DATA_DELETE_IDEMPOTENCY_CONFLICT");
      return deletionView(tx, existing, now);
    }
    const plan = await buildDatabaseDeletePlan(tx, input.target);
    if (plan.fingerprint !== input.fingerprint) throw new DataDeleteError("DATA_DELETE_PREVIEW_CHANGED");
    if (plan.blockers.length || !plan.items.length) throw new DataDeleteError("DATA_DELETE_BLOCKED");
    const availableAt = new Date(now.getTime() + (input.target.scope === "RESOURCE" ? DATA_TRASH_RETENTION_MS : DATA_DELETE_COOLDOWN_MS));
    const row = await tx.dataDeletionIntent.create({ data: { ...input.target, state: input.target.scope === "RESOURCE" ? "TRASHED" : "COOLDOWN",
      idempotencyKey: input.idempotencyKey, requestHash, fingerprint: plan.fingerprint, authorizationHash: plan.authorizationHash, schemaHash: plan.schemaHash,
      availableAt, frozenAt: now, receiptTokenHash: receiptHash(input.receiptToken), receiptExpiresAt: new Date(availableAt.getTime() + 3_600_000) } });
    for (let index = 0; index < plan.items.length; index += 500) {
      const items = plan.items.slice(index, index + 500);
      await tx.dataDeletionItem.createMany({ data: items.map(item => ({ intentId: row.id, model: item.model, keyJson: item.key, identityHash: item.identityHash, rowHash: item.rowHash })) });
      await tx.dataDeletionFence.createMany({ data: items.map(item => ({ intentId: row.id, model: item.model, keyJson: item.key, identityHash: item.identityHash })) });
    }
    return deletionView(tx, row, now);
  }, { timeout: 60_000 });
}

export async function controlDatabaseDeletion(client: PrismaClient, input: { actor: DeleteActor; intentId: string; expectedRevision: number; action: "cancel" | "restore" | "retry" }) {
  deleteIdentifier(input.intentId);
  return client.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DELETE_FENCE_LOCK})`;
    await tx.$queryRaw`SELECT id FROM "DataDeletionIntent" WHERE id=${input.intentId} FOR UPDATE`;
    const now = await deleteClock(tx); await requireDeleteActor(tx, input.actor, now);
    const row = await tx.dataDeletionIntent.findUnique({ where: { id: input.intentId } });
    if (!row || row.requesterId !== input.actor.id) throw new DataDeleteError("DATA_DELETE_NOT_FOUND");
    if (row.revision !== input.expectedRevision) throw new DataDeleteError("DATA_DELETE_REVISION_CONFLICT");
    const restore = input.action === "restore";
    let refreshed: { fingerprint: string; authorizationHash: string } | undefined;
    if (input.action === "retry") {
      requireDataDeleteEnabled();
      if (row.state !== "FAILED") throw new DataDeleteError("DATA_DELETE_CONTROL_INVALID");
      const plan = await buildDatabaseDeletePlan(tx, { requesterId: row.requesterId, scope: row.scope as DataDeleteTarget["scope"],
        workspaceId: row.workspaceId, resourceType: row.resourceType as DataDeleteTarget["resourceType"], resourceId: row.resourceId }, row.id);
      const prior = await tx.dataDeletionItem.findMany({ where: { intentId: row.id } });
      const same = new Map(prior.map(item => [item.identityHash, hashDataExportValue({ model: item.model, key: item.keyJson, rowHash: item.rowHash })]));
      if (plan.blockers.length || plan.schemaHash !== row.schemaHash || plan.items.length !== same.size
        || plan.items.some(item => same.get(item.identityHash) !== hashDataExportValue({ model: item.model, key: item.key, rowHash: item.rowHash }))) {
        throw new DataDeleteError("DATA_DELETE_RECONFIRMATION_SCOPE_CHANGED");
      }
      // 近期重新验证可以重绑权限 epoch，但不能增加或改写冻结对象；不延长恢复期。
      refreshed = { fingerprint: plan.fingerprint, authorizationHash: plan.authorizationHash };
    } else if (row.irreversibleAt || ["SUCCEEDED", "CANCELLED", "RESTORED"].includes(row.state)
      || (restore && (row.scope !== "RESOURCE" || row.availableAt <= now)) || (!restore && row.scope === "RESOURCE")) {
      throw new DataDeleteError("DATA_DELETE_CONTROL_INVALID");
    }
    if (input.action !== "retry") await tx.dataDeletionFence.deleteMany({ where: { intentId: row.id } });
    const changed = await tx.dataDeletionIntent.update({ where: { id: row.id }, data: { state: input.action === "retry" ? "RETRY_WAIT" : restore ? "RESTORED" : "CANCELLED",
      ...refreshed,
      revision: { increment: 1 }, leaseOwner: null, leaseExpiresAt: null, executionPid: null, errorCode: null,
      nextAttemptAt: input.action === "retry" ? now : null, ...(input.action === "retry" ? { attempt: 0 } : { completedAt: now }) } });
    return deletionView(tx, changed, now);
  }, { timeout: 60_000 });
}

export async function listDatabaseDeletions(client: PrismaClient, requesterId: string) {
  const rows = await client.dataDeletionIntent.findMany({ where: { requesterId: deleteIdentifier(requesterId) }, orderBy: { createdAt: "desc" }, take: 100 });
  const now = new Date();
  return Promise.all(rows.map(row => deletionView(client, row, now)));
}

export async function readDeletionReceipt(client: PrismaClient, intentId: string, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new DataDeleteError("DATA_DELETE_NOT_FOUND");
  const row = await client.dataDeletionIntent.findUnique({ where: { id: deleteIdentifier(intentId) } });
  if (!row || row.receiptExpiresAt <= new Date() || !timingSafeEqual(Buffer.from(row.receiptTokenHash), Buffer.from(receiptHash(token)))) {
    throw new DataDeleteError("DATA_DELETE_NOT_FOUND");
  }
  return deletionView(client, row, new Date());
}

export async function deletionView(tx: Prisma.TransactionClient, row: DataDeletionIntent, now: Date) {
  const counts = await tx.dataDeletionItem.groupBy({ by: ["model"], where: { intentId: row.id }, _count: true });
  const controls = dataDeleteControlAllowed(row.state as DataDeleteState, row.irreversibleAt);
  return { id: row.id, scope: row.scope, resourceType: row.resourceType, workspaceId: row.workspaceId, state: row.state,
    revision: row.revision, availableAt: row.availableAt.toISOString(), createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null, irreversible: row.irreversibleAt !== null, errorCode: row.errorCode,
    counts: Object.fromEntries(counts.map(group => [group.model, group._count])), attempt: row.attempt,
    ...controls, canRestore: controls.canRestore && row.availableAt > now };
}

export async function deleteClock(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  if (!row) throw new DataDeleteError("DATA_DELETE_CLOCK_UNAVAILABLE");
  return row.now;
}
function receiptHash(token: string) { return createHash("sha256").update("areaforge-delete-receipt-v1:" + token).digest("hex"); }
