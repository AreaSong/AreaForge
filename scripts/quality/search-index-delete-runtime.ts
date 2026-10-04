import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { type DataDeleteTarget, type DataTrashResourceType } from "../../packages/core/src/index";
import { previewDatabaseDeletion, createDatabaseDeletion, controlDatabaseDeletion, type PrismaClient } from "../../packages/db/src/index";
import { verifyFrozenDeletePlan } from "../../packages/db/src/data-delete-commit";
import { claimDatabaseDeletion } from "../../packages/db/src/data-delete-lease";
import { executeDatabaseDeletion } from "../workers/data-delete-worker";
import type { CurrentUser } from "../../apps/web/lib/auth/session";
import { createSearchCase, requestSearchCase, consumeSearchCase, querySearchCase, searchSourceState } from "./search-index-runtime-data";
import type { SearchIndexFixture } from "./search-index-fixture";

export async function withSearchDeletion<T>(run: () => Promise<T>): Promise<T> {
  const saved = { DATA_LIFECYCLE_ENABLED: process.env.DATA_LIFECYCLE_ENABLED, DATA_DELETE_ENABLED: process.env.DATA_DELETE_ENABLED };
  process.env.DATA_LIFECYCLE_ENABLED = "true"; process.env.DATA_DELETE_ENABLED = "true";
  try { return await run(); }
  finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

export async function freezeSearchTarget(client: PrismaClient, actor: CurrentUser, target: DataDeleteTarget) {
  const preview = await previewDatabaseDeletion(client, actor, target);
  if (preview.blockers.length) console.error(`SEARCH_DELETE_BLOCKERS:${preview.blockers.join(",")}`);
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.items.some(item => ["Attachment", "DataExportArtifact"].includes(item.model)), false);
  return createDatabaseDeletion(client, { actor, target, fingerprint: preview.fingerprint,
    idempotencyKey: randomUUID(), receiptToken: randomBytes(32).toString("hex") });
}

export async function restoreSearchTarget(client: PrismaClient, actor: CurrentUser, id: string) {
  const row = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id } });
  return controlDatabaseDeletion(client, { actor, intentId: id, expectedRevision: row.revision, action: row.scope === "RESOURCE" ? "restore" : "cancel" });
}

export async function eraseSearchTarget(client: PrismaClient, fixture: SearchIndexFixture, id: string) {
  const row = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id } });
  const retention = (row.scope === "RESOURCE" ? 30 : 1) * 86_400_000;
  // 只推进本批合成时钟，仍满足原冷静期/保留期差值，不修改产品约束。
  await client.dataDeletionIntent.update({ where: { id }, data: { frozenAt: new Date(Date.now() - retention - 10_000), availableAt: new Date(Date.now() - 5000) } });
  const lease = await claimDatabaseDeletion(client, "search-fixture-delete", id); assert.ok(lease);
  const result = await executeDatabaseDeletion(client, lease, { uploadRoot: path.join(fixture.root, "uploads"), exportRoot: path.join(fixture.root, "exports") });
  assert.equal(result.state, "SUCCEEDED"); assert.equal(await client.dataDeletionFile.count({ where: { intentId: id } }), 0);
}

export async function searchFrozenCopies(client: PrismaClient, fixture: SearchIndexFixture) {
  await withSearchDeletion(async () => {
    const data = await createSearchCase(client, fixture, "frozen-copies");
    for (const actor of [data.owner, data.viewer]) { await requestSearchCase(client, data, actor); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]); }
    const target: DataDeleteTarget = { requesterId: data.member.id, scope: "RESOURCE", workspaceId: data.workspace.id, resourceType: "Note", resourceId: data.foreign.note.id };
    const intent = await freezeSearchTarget(client, data.member, target);
    const frozenDocs = await client.workspaceSearchDocument.findMany({ where: { noteId: data.foreign.note.id }, orderBy: { id: "asc" } });
    assert.equal(frozenDocs.length, 2);
    const fences = await client.dataDeletionFence.findMany({ where: { intentId: intent.id }, orderBy: { identityHash: "asc" } });
    assert.equal((await querySearchCase(data)).results.some(row => row.id === data.foreign.note.id), false);
    await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
    assert.deepEqual(await client.workspaceSearchDocument.findMany({ where: { noteId: data.foreign.note.id }, orderBy: { id: "asc" } }), frozenDocs);
    assert.deepEqual(await client.dataDeletionFence.findMany({ where: { intentId: intent.id }, orderBy: { identityHash: "asc" } }), fences);
    const frozen = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: intent.id } });
    await client.$transaction(tx => verifyFrozenDeletePlan(tx, frozen), { timeout: 60_000 });
    await assert.rejects(client.workspaceSearchDocument.update({ where: { id: frozenDocs[0]!.id }, data: { title: "forbidden" } }));
    await assert.rejects(client.workspaceSearchDocument.delete({ where: { id: frozenDocs[0]!.id } }));
    await restoreSearchTarget(client, data.member, intent.id);
    const restored = await querySearchCase(data); assert.equal(restored.indexed, false); assert.ok(restored.results.some(row => row.id === data.foreign.note.id));
    await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
    const purge = await freezeSearchTarget(client, data.member, target); await eraseSearchTarget(client, fixture, purge.id);
    assert.equal(await client.note.findUnique({ where: { id: data.foreign.note.id } }), null);
    assert.equal(await client.workspaceSearchDocument.count({ where: { noteId: data.foreign.note.id } }), 0);
    assert.ok(await client.note.findUnique({ where: { id: data.own.note.id } }));
  });
}

export async function searchViewerDeletion(client: PrismaClient, fixture: SearchIndexFixture) {
  await withSearchDeletion(async () => {
    const data = await createSearchCase(client, fixture, "viewer-delete");
    for (const actor of [data.owner, data.viewer]) { await requestSearchCase(client, data, actor); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]); }
    const before = await searchSourceState(client, data);
    const ownPartition = await client.workspaceSearchPartition.findUniqueOrThrow({ where: { userId_workspaceId: { userId: data.owner.id, workspaceId: data.workspace.id } } });
    const ownDocs = await client.workspaceSearchDocument.findMany({ where: { partitionId: ownPartition.id }, orderBy: { id: "asc" } });
    const intent = await freezeSearchTarget(client, data.viewer, { requesterId: data.viewer.id, scope: "ACCOUNT", workspaceId: null, resourceType: null, resourceId: null });
    await assert.rejects(querySearchCase(data, data.viewer), /NOT_FOUND/);
    await assert.rejects(requestSearchCase(client, data, data.viewer), /NOT_FOUND/);
    await eraseSearchTarget(client, fixture, intent.id);
    assert.equal(await client.user.findUnique({ where: { id: data.viewer.id } }), null);
    assert.deepEqual(await searchSourceState(client, data), before);
    assert.deepEqual(await client.workspaceSearchDocument.findMany({ where: { partitionId: ownPartition.id }, orderBy: { id: "asc" } }), ownDocs);
    assert.equal(await client.workspaceSearchPartition.count({ where: { userId: data.viewer.id } }), 0);
  });
}

export async function searchFiveResourceDeletes(client: PrismaClient, fixture: SearchIndexFixture) {
  await withSearchDeletion(async () => {
    for (const [kind, field] of [["Note", "note"], ["Mistake", "mistake"], ["StudyTask", "task"], ["StudyResource", "resource"], ["KnowledgePoint", "point"]] as const) {
      const data = await createSearchCase(client, fixture, `delete-${kind}`);
      await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
      const source = data.own[field];
      const intent = await freezeSearchTarget(client, data.owner, { requesterId: data.owner.id, scope: "RESOURCE", workspaceId: data.workspace.id, resourceType: kind, resourceId: source.id });
      await eraseSearchTarget(client, fixture, intent.id);
      assert.equal(await client.workspaceSearchDocument.count({ where: { sourceId: source.id } }), 0);
      assert.equal((await querySearchCase(data)).results.some(row => row.id === source.id), false);
      await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
    }
  });
}

export async function searchMovedSourceDelete(client: PrismaClient, fixture: SearchIndexFixture) {
  await withSearchDeletion(async () => {
    const data = await createSearchCase(client, fixture, "moved-source"); await requestSearchCase(client, data);
    assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
    await client.workspaceMembership.create({ data: { userId: data.member.id, workspaceId: data.secondary.id, role: "MEMBER" } });
    await client.note.update({ where: { id: data.foreign.note.id }, data: { subjectId: data.secondarySubject.id } });
    assert.equal((await querySearchCase(data)).results.some(row => row.id === data.foreign.note.id), false);
    // 原工作区 grant 属于既有非搜索引用，仍须阻断；不能借搜索副本例外放宽它。
    const blocked = await previewDatabaseDeletion(client, data.member, { requesterId: data.member.id, scope: "RESOURCE", workspaceId: data.secondary.id, resourceType: "Note", resourceId: data.foreign.note.id });
    assert.ok(blocked.blockers.includes("DATA_DELETE_FOREIGN_REFERENCE"));
    await client.note.update({ where: { id: data.own.note.id }, data: { subjectId: data.secondarySubject.id } });
    const intent = await freezeSearchTarget(client, data.owner, { requesterId: data.owner.id, scope: "RESOURCE", workspaceId: data.secondary.id, resourceType: "Note", resourceId: data.own.note.id });
    await eraseSearchTarget(client, fixture, intent.id);
    assert.equal(await client.workspaceSearchDocument.count({ where: { noteId: data.own.note.id } }), 0);
    assert.ok(await client.note.findUnique({ where: { id: data.foreign.note.id } }));
  });
}

export async function searchForeignReferencesRemainBlocked(client: PrismaClient, fixture: SearchIndexFixture) {
  await withSearchDeletion(async () => {
    const data = await createSearchCase(client, fixture, "foreign-reference");
    await client.noteMistakeLink.create({ data: { noteId: data.foreign.note.id, mistakeId: data.own.mistake.id } });
    const target = { requesterId: data.member.id, scope: "RESOURCE" as const, workspaceId: data.workspace.id, resourceType: "Note" as DataTrashResourceType, resourceId: data.foreign.note.id };
    const preview = await previewDatabaseDeletion(client, data.member, target); assert.ok(preview.blockers.includes("DATA_DELETE_FOREIGN_REFERENCE"));
    assert.equal(await client.dataDeletionIntent.count({ where: { requesterId: data.member.id } }), 0);
  });
}
