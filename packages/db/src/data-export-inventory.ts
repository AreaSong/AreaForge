import { DataExportError, type DataExportRecordInput } from "@areaforge/core";
import type { PrismaClient, Prisma } from "../generated/prisma/client";
import { appendPrimaryExportRecords } from "./data-export-inventory-primary";
import { appendExtendedExportRecords } from "./data-export-inventory-records";
import { appendRelatedExportRecords } from "./data-export-inventory-related-records";
import { appendRows, metadataOnlyTarget, type DataExportRecordConsumer, type ExportRecordDelegate } from "./data-export-record-target";

export interface DataExportInventoryInput {
  actor: { id: string; email: string };
  workspaceIds: readonly string[];
  scope: "ACCOUNT" | "WORKSPACE";
  includeData: boolean;
  signal?: AbortSignal;
}
type DbClient = PrismaClient | Prisma.TransactionClient;
type References = { subject: Set<string>; group: Set<string>; node: Set<string>; entities: Map<string, Set<string>> };
type InventoryContext = { db: Record<string, ExportRecordDelegate>; records: DataExportRecordConsumer; input: DataExportInventoryInput; refs: References; owned: string[]; foreign: string[] };

export async function collectDataExportRecords(client: DbClient, input: DataExportInventoryInput): Promise<DataExportRecordInput[]> {
  const records: DataExportRecordInput[] = [];
  await streamDataExportRecords(client, input, { batchSize: 256, emit: async record => { records.push(record); } });
  return records;
}

export async function streamDataExportRecords(client: DbClient, input: DataExportInventoryInput, target: DataExportRecordConsumer): Promise<void> {
  const refs: References = { subject: new Set(), group: new Set(), node: new Set(), entities: new Map() };
  let count = 0;
  const records: DataExportRecordConsumer = { signal: input.signal ?? target.signal, batchSize: target.batchSize ?? 1, emit: async record => {
    if (++count > 100_000) throw new DataExportError("DATA_EXPORT_LIMIT_EXCEEDED");
    rememberReferences(refs, record); await target.emit(record);
  } };
  const { actor, workspaceIds, scope, includeData } = input;
  await appendPrimaryExportRecords(client, records, actor.id, workspaceIds, scope, includeData);
  await appendExtendedExportRecords(client, records, actor.id, workspaceIds, scope, includeData);
  await appendRelatedExportRecords(client, records, actor.id, actor.email, workspaceIds, scope, includeData);
  const ownRows = await client.examWorkspace.findMany({ where: { id: { in: [...workspaceIds] }, userId: actor.id }, select: { id: true } });
  const owned = ownRows.map(row => row.id); const ownSet = new Set(owned);
  const context: InventoryContext = { db: client as unknown as Record<string, ExportRecordDelegate>, records, input, refs, owned, foreign: workspaceIds.filter(id => !ownSet.has(id)) };
  await appendWorkspaceContext(context); await appendNodeContext(context); await appendSubjectContext(context); await appendAuditRecords(context);
}

function rememberReferences(refs: References, record: DataExportRecordInput) {
  const data = record.data as Record<string, unknown>;
  for (const key of ["subjectId", "primarySubjectId"]) remember(refs.subject, data[key]);
  if (record.kind === "subject") remember(refs.group, data.groupId);
  for (const key of ["syllabusNodeId", "primaryNodeId"]) remember(refs.node, data[key]);
  if (Array.isArray(data.relatedNodeIds)) for (const id of data.relatedNodeIds) remember(refs.node, id);
  if (record.kind === "auditEvent") return;
  const type = record.kind === "workspace" ? "ExamWorkspace" : record.kind === "account" ? "User" : record.kind[0]!.toUpperCase() + record.kind.slice(1);
  const ids = refs.entities.get(type) ?? new Set<string>(); ids.add(record.id); refs.entities.set(type, ids);
}
function remember(values: Set<string>, value: unknown) { if (typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)) values.add(value); }

async function appendWorkspaceContext(context: InventoryContext) {
  const { db, records, owned, foreign, input } = context;
  await appendRows(db, records, "workspace", "examWorkspace", { id: { in: owned } }, {
    id: true, userId: true, stableKey: true, name: true, targetExamDate: true, stageSummary: input.includeData,
    status: true, revision: true, archivedAt: true, createdAt: true, updatedAt: true,
  });
  await appendRows(db, metadataOnlyTarget(records), "workspace", "examWorkspace", { id: { in: foreign } }, { id: true });
  await appendRows(db, records, "workspaceMembership", "workspaceMembership", { userId: input.actor.id, workspaceId: { in: [...input.workspaceIds] } }, {
    id: true, workspaceId: true, userId: true, role: true, status: true, revision: true, joinedAt: true, leftAt: true, removedAt: true, createdAt: true, updatedAt: true,
  });
}

async function appendNodeContext(context: InventoryContext) {
  const { db, records, owned, foreign, refs } = context;
  await appendRows(db, records, "syllabusNode", "syllabusNode", { subject: { workspaceId: { in: owned } } }, {
    id: true, subjectId: true, parentId: true, title: true, kind: true, status: true, masteryLevel: true,
    sortOrder: true, targetMinutes: true, actualMinutes: true, stableKey: true, revision: true, archivedAt: true, createdAt: true, updatedAt: true,
  });
  // 历史成员只拿到本人记录引用的结构 ID，不重新导出对方当前考纲和学习进度。
  for (const ids of chunks(refs.node)) await appendRows(db, metadataOnlyTarget(records), "syllabusNode", "syllabusNode", {
    id: { in: ids }, subject: { workspaceId: { in: foreign } },
  }, { id: true, subjectId: true, parentId: true });
}

async function appendSubjectContext(context: InventoryContext) {
  const { db, records, owned, foreign, refs } = context;
  await appendRows(db, records, "subject", "subject", { workspaceId: { in: owned } }, {
    id: true, workspaceId: true, groupId: true, stableKey: true, name: true, color: true, sortOrder: true, archivedAt: true, createdAt: true, updatedAt: true,
  });
  for (const ids of chunks(refs.subject)) await appendRows(db, metadataOnlyTarget(records), "subject", "subject", {
    id: { in: ids }, workspaceId: { in: foreign },
  }, { id: true, workspaceId: true, groupId: true });
  await appendRows(db, records, "subjectGroup", "subjectGroup", { workspaceId: { in: owned } }, {
    id: true, workspaceId: true, stableKey: true, name: true, sortOrder: true, archivedAt: true, createdAt: true, updatedAt: true,
  });
  for (const ids of chunks(refs.group)) await appendRows(db, metadataOnlyTarget(records), "subjectGroup", "subjectGroup", {
    id: { in: ids }, workspaceId: { in: foreign },
  }, { id: true, workspaceId: true });
}

async function appendAuditRecords(context: InventoryContext) {
  const { db, records, input, refs } = context;
  const fields = { id: true, actorId: true, action: true, entityType: true, entityId: true, createdAt: true };
  if (input.scope === "ACCOUNT") {
    await appendRows(db, records, "auditEvent", "auditEvent", { actorId: input.actor.id }, fields);
    return;
  }
  // 同时绑定实体种类与 ID；跨模型重用 ID 不能把另一工作区事件带入包。
  for (const [entityType, references] of [...refs.entities]) {
    for (const ids of chunks(references)) await appendRows(db, records, "auditEvent", "auditEvent", {
      actorId: input.actor.id, entityType, entityId: { in: ids },
    }, fields);
  }
}
function* chunks(values: Set<string>) {
  const sorted = [...values].sort();
  for (let index = 0; index < sorted.length; index += 500) yield sorted.slice(index, index + 500);
}
