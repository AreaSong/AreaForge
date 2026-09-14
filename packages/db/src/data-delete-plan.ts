import { createDataDeletePlan, DataDeleteError, DATA_DELETE_MAX_ITEMS, hashDataExportValue, validateDataDeleteTarget,
  type DataDeletePlan, type DataDeleteTarget } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { accountOnlyDeleteModels, deleteLinkModels, deleteModel, deleteOwnerFields, deleteParentFields, deletePrimaryKey,
  deleteRelations, deleteRetainedModels, sourceDeleteModels, type DeleteRelation } from "./data-delete-models";
import { deleteKeyPredicate, deleteScopePredicate, quotedDeleteName, readDeleteRecords, type DeleteRecord, type DeleteTx } from "./data-delete-query";
import { deleteSoftReferences, softDeletePredicate } from "./data-delete-references";

type PlanContext = { tx: DeleteTx; target: DataDeleteTarget; records: Map<string, DeleteRecord>; blockers: Set<string>; relations: DeleteRelation[]; intentId?: string; recovery: boolean };

export async function buildDatabaseDeletePlan(tx: DeleteTx, target: DataDeleteTarget, intentId?: string): Promise<DataDeletePlan> {
  return buildDeletePlan(tx, target, intentId, false);
}

/** 只供验证过外部 ledger head 的隔离恢复流程使用；恢复的旧登录状态不是授权源。 */
export async function buildRestorationDeletePlan(tx: DeleteTx, target: DataDeleteTarget, intentId?: string): Promise<DataDeletePlan> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${target.requesterId} FOR UPDATE NOWAIT`;
  if (target.scope === "WORKSPACE") {
    const row = await tx.examWorkspace.findUnique({ where: { id: target.workspaceId! }, select: { userId: true } });
    if (row?.userId !== target.requesterId) throw new DataDeleteError("DATA_DELETE_RESTORE_OWNER_CHANGED");
  }
  return buildDeletePlan(tx, target, intentId, true);
}

async function buildDeletePlan(tx: DeleteTx, target: DataDeleteTarget, intentId: string | undefined, recovery: boolean): Promise<DataDeletePlan> {
  validateDataDeleteTarget(target);
  const authorizationHash = recovery ? hashDataExportValue({ protocol: "data-delete-restoration-authority-v1", target }) : await readDeleteAuthorization(tx, target, intentId !== undefined);
  const models = sourceDeleteModels();
  const context: PlanContext = { tx, target, records: new Map(), blockers: new Set(), relations: deleteRelations(), intentId, recovery };
  if (target.scope === "RESOURCE") {
    const rows = await readDeleteRecords(tx, target.resourceType!, Prisma.sql`${deleteKeyPredicate({ id: target.resourceId! })} AND (${deleteScopePredicate(target.resourceType!, target)})`);
    if (rows.length !== 1) throw new DataDeleteError("DATA_DELETE_NOT_FOUND");
    addRecords(context, rows);
  } else {
    for (const model of models) {
      if (deleteRetainedModels.includes(model.name as never) || deleteLinkModels.includes(model.name as never)) continue;
      if (target.scope === "ACCOUNT" && ["AuthSession", "AuthActionToken"].includes(model.name)) continue;
      if (target.scope !== "ACCOUNT" && accountOnlyDeleteModels.includes(model.name)) continue;
      // 这些间接实体随 owning parent 闭包加入，不把“可导出的关联”当成删除权。
      if (!deleteOwnerFields[model.name] && !deleteParentFields[model.name]) continue;
      const predicate = deleteScopePredicate(model.name, target);
      addRecords(context, await readDeleteRecords(tx, model.name, model.name === "AuditEvent" ? Prisma.sql`(${predicate}) AND left(s.action,5)<>'AUTH_'` : predicate));
    }
  }
  await expandDeleteClosure(context);
  await inspectDeleteBlockers(context);
  return createDataDeletePlan({ target, authorizationHash, schemaHash: hashDataExportValue({ models, softReferences: deleteSoftReferences }),
    items: [...context.records.values()].map(({ metadata: _metadata, ...item }) => item), blockers: [...context.blockers] });
}

export async function readDeleteAuthorization(tx: DeleteTx, target: DataDeleteTarget, lock = false): Promise<string> {
  if (lock) {
    if (target.scope === "ACCOUNT") await tx.$queryRaw`SELECT id FROM "User" WHERE id=${target.requesterId} FOR UPDATE NOWAIT`;
    else await tx.$queryRaw`SELECT id FROM "User" WHERE id=${target.requesterId} FOR SHARE NOWAIT`;
    if (target.workspaceId) {
      await tx.$queryRaw`SELECT id FROM "ExamWorkspace" WHERE id=${target.workspaceId} FOR SHARE NOWAIT`;
      await tx.$queryRaw`SELECT id FROM "WorkspaceMembership" WHERE "workspaceId"=${target.workspaceId} AND "userId"=${target.requesterId} FOR SHARE NOWAIT`;
    }
  }
  const user = await tx.user.findUnique({ where: { id: target.requesterId }, select: { id: true, status: true, authRevision: true } });
  if (user?.status !== "ACTIVE") throw new DataDeleteError("DATA_DELETE_AUTHORIZATION_CHANGED");
  const where = target.scope === "ACCOUNT" ? { OR: [{ userId: target.requesterId }, { memberships: { some: { userId: target.requesterId } } }] } : { id: target.workspaceId! };
  const workspaces = await tx.examWorkspace.findMany({ where, orderBy: { id: "asc" }, take: 10001,
    select: { id: true, userId: true, status: true, revision: true,
      memberships: { where: { userId: target.requesterId }, select: { id: true, userId: true, status: true, role: true, revision: true } } } });
  if (workspaces.length > 10000) throw new DataDeleteError("DATA_DELETE_LIMIT_EXCEEDED");
  if (lock && target.scope === "ACCOUNT" && workspaces.length) {
    const ids = workspaces.map(workspace => workspace.id);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "ExamWorkspace" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE NOWAIT`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "WorkspaceMembership" WHERE "workspaceId" IN (${Prisma.join(ids)}) AND "userId"=${target.requesterId} ORDER BY id FOR SHARE NOWAIT`);
    const current = await tx.examWorkspace.findMany({ where, orderBy: { id: "asc" }, take: 10001, select: { id: true, userId: true, status: true, revision: true,
      memberships: { where: { userId: target.requesterId }, select: { id: true, userId: true, status: true, role: true, revision: true } } } });
    if (hashDataExportValue(current) !== hashDataExportValue(workspaces)) throw new DataDeleteError("DATA_DELETE_SCOPE_BUSY", true);
  }
  if (target.scope !== "ACCOUNT") {
    const workspace = workspaces[0]; const member = workspace?.memberships[0];
    if (workspaces.length !== 1 || workspace?.status !== "ACTIVE" || member?.status !== "ACTIVE"
      || (target.scope === "WORKSPACE" && (workspace.userId !== user.id || member.role !== "OWNER"))) {
      throw new DataDeleteError("DATA_DELETE_AUTHORIZATION_CHANGED");
    }
  }
  return hashDataExportValue({ user, workspaces });
}

async function expandDeleteClosure(context: PlanContext) {
  let previous = -1;
  for (let round = 0; round < 100 && previous !== context.records.size; round++) {
    previous = context.records.size;
    for (const relation of context.relations) {
      const parents = recordsFor(context, relation.parent);
      if (!parents.length) continue;
      for (const batch of chunks(parents)) await includeAffected(context, relation.child, await readDeleteRecords(context.tx, relation.child, referencePredicate(relation, batch)));
    }
    for (const relation of deleteSoftReferences) {
      const ids = recordsFor(context, relation.parent).flatMap(row => typeof row.key.id === "string" ? [row.key.id] : []);
      for (const batch of chunks(ids)) await includeAffected(context, relation.child, await readDeleteRecords(context.tx, relation.child, softDeletePredicate(relation, batch)));
    }
    await includeDeleteAudit(context);
  }
  if (previous !== context.records.size) throw new DataDeleteError("DATA_DELETE_CLOSURE_LIMIT");
}

async function includeAffected(context: PlanContext, model: string, rows: DeleteRecord[]) {
  for (const row of rows) {
    if (context.target.scope === "ACCOUNT" && ((["AuthSession", "AuthActionToken"].includes(model) && row.metadata.userId === context.target.requesterId)
      || (model === "AuditEvent" && row.metadata.actorId === context.target.requesterId && String(row.metadata.action).startsWith("AUTH_")))) continue;
    if (context.records.has(row.identityHash)) continue;
    if (deleteRetainedModels.includes(model as never)) { context.blockers.add("DATA_DELETE_RETAINED_REFERENCE"); continue; }
    const permitted = deleteLinkModels.includes(model as never) ? await ownedLink(context, row)
      : (await readDeleteRecords(context.tx, model, Prisma.sql`${deleteKeyPredicate(row.key)} AND (${deleteScopePredicate(model, context.target)})`)).length === 1;
    if (permitted) addRecords(context, [row]); else context.blockers.add("DATA_DELETE_FOREIGN_REFERENCE");
  }
}

async function ownedLink(context: PlanContext, row: DeleteRecord): Promise<boolean> {
  let owned = 0;
  for (const relation of context.relations.filter(edge => edge.child === row.model)) {
    if (["User", "Subject", "SubjectGroup", "SyllabusNode", "ExamWorkspace"].includes(relation.parent)) continue;
    const key = referenceKey(relation, row.metadata);
    if (!key) continue;
    if (!deleteOwnerFields[relation.parent] && !deleteParentFields[relation.parent]) return false;
    const parent = await readDeleteRecords(context.tx, relation.parent, Prisma.sql`${deleteKeyPredicate(key)} AND (${deleteScopePredicate(relation.parent, context.target)})`);
    if (parent.length !== 1) return false;
    owned++;
  }
  return owned > 0;
}

async function includeDeleteAudit(context: PlanContext) {
  if (context.target.scope === "ACCOUNT") return;
  for (const model of new Set([...context.records.values()].map(row => row.model))) {
    if (model === "AuditEvent") continue;
    const ids = recordsFor(context, model).flatMap(row => row.key.id ? [row.key.id] : []);
    for (const batch of chunks(ids)) {
      const rows = await readDeleteRecords(context.tx, "AuditEvent", Prisma.sql`s."entityType" = ${model} AND s."entityId" IN (${Prisma.join(batch)})`);
      for (const row of rows) {
        if (row.metadata.actorId !== context.target.requesterId) context.blockers.add("DATA_DELETE_FOREIGN_REFERENCE");
        else addRecords(context, [row]);
      }
    }
  }
}

async function inspectDeleteBlockers(context: PlanContext) {
  for (const row of context.records.values()) {
    if (row.model === "PrivateChallenge" && row.metadata.status !== "DISSOLVED") context.blockers.add("DATA_DELETE_CHALLENGE_OWNED");
    if (row.model === "WorkspaceInvitation" && row.metadata.status === "PENDING") context.blockers.add("DATA_DELETE_INVITATION_ACTIVE");
    if (!context.recovery && row.model === "StudySession" && ["RUNNING", "PAUSED", "CLOSING"].includes(String(row.metadata.status))) context.blockers.add("DATA_DELETE_SESSION_ACTIVE");
    if (row.model === "Attachment" && row.metadata.status !== "READY") context.blockers.add("DATA_DELETE_ATTACHMENT_UNSETTLED");
    if (!context.recovery && row.model === "DataJob" && ["QUEUED", "RUNNING", "PAUSED", "CANCEL_REQUESTED"].includes(String(row.metadata.status))) context.blockers.add("DATA_DELETE_JOB_ACTIVE");
    if (row.model === "DataExportArtifact" && !["PUBLISHED", "RECLAIMED"].includes(String(row.metadata.state))) context.blockers.add("DATA_DELETE_EXPORT_UNSETTLED");
    if (row.model === "Attachment") {
      const attachment = await context.tx.attachment.findUniqueOrThrow({ where: { id: row.key.id! }, select: { id: true, storedName: true, uri: true } });
      const peers = await context.tx.attachment.count({ where: { id: { not: attachment.id }, OR: [{ storedName: attachment.storedName }, { uri: attachment.uri }] } });
      if (peers) context.blockers.add("DATA_DELETE_FILE_REFERENCE_AMBIGUOUS");
    }
    if (row.model === "DataExportArtifact") {
      const artifact = await context.tx.dataExportArtifact.findUniqueOrThrow({ where: { id: row.key.id! }, include: { exportPackage: true } });
      const peers = await context.tx.dataExportPackage.findMany({ where: { objectKey: artifact.objectKey }, select: { jobId: true, sourceArtifactId: true } });
      if (peers.some(peer => peer.jobId !== artifact.jobId || peer.sourceArtifactId !== artifact.id)
        || (artifact.exportPackage && (artifact.exportPackage.objectKey !== artifact.objectKey || artifact.exportPackage.jobId !== artifact.jobId))) {
        context.blockers.add("DATA_DELETE_EXPORT_UNSETTLED");
      }
    }
  }
  const identities = [...context.records.keys()];
  for (const batch of chunks(identities)) {
    if (!context.recovery && await context.tx.dataDeletionFence.count({ where: { identityHash: { in: batch }, ...(context.intentId ? { intentId: { not: context.intentId } } : {}) } })) context.blockers.add("DATA_DELETE_ALREADY_FROZEN");
  }
  // 必须显式覆盖全部实际模型，后加表或漏装栅栏不能静默获得删除权限。
  const tables = await context.tx.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables WHERE schemaname=current_schema() AND tablename <> '_prisma_migrations' AND tablename NOT LIKE 'DataDeletion%'`;
  const actual = tables.map(row => row.name).sort(); const expected = sourceDeleteModels().map(model => model.name).sort();
  if (hashDataExportValue(actual) !== hashDataExportValue(expected)) context.blockers.add("DATA_DELETE_SCHEMA_DRIFT");
}

function addRecords(context: PlanContext, rows: readonly DeleteRecord[]) {
  for (const row of rows) context.records.set(row.identityHash, row);
  if (context.records.size > DATA_DELETE_MAX_ITEMS || rows.length > DATA_DELETE_MAX_ITEMS) throw new DataDeleteError("DATA_DELETE_LIMIT_EXCEEDED");
}
const recordsFor = (context: PlanContext, model: string) => [...context.records.values()].filter(row => row.model === model);
function referencePredicate(relation: DeleteRelation, parents: DeleteRecord[]) {
  return Prisma.join(parents.map(parent => Prisma.sql`(${Prisma.join(relation.childColumns.map((column, index) => {
    const value = parent.key[relation.parentColumns[index]!] ?? parent.metadata[relation.parentColumns[index]!];
    return Prisma.sql`s.${quotedDeleteName(column)} = ${value as string}`;
  }), " AND ")})`), " OR ");
}
export function referenceKey(relation: DeleteRelation, metadata: Record<string, unknown>): Record<string, string> | null {
  const key: Record<string, string> = {};
  for (let index = 0; index < relation.childColumns.length; index++) {
    const value = metadata[relation.childColumns[index]!];
    if (typeof value !== "string") return null;
    key[relation.parentColumns[index]!] = value;
  }
  return key;
}
function* chunks<T>(values: readonly T[]): Generator<T[]> { for (let index = 0; index < values.length; index += 200) yield values.slice(index, index + 200); }
