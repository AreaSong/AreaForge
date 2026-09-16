import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { controlWorkspaceSearchIndex, type PrismaClient } from "../../packages/db/src/index";
import { createSearchCase, requestSearchCase, consumeSearchCase, querySearchCase } from "./search-index-runtime-data";
import { withSearchLock } from "./search-index-race-runtime";
import { freezeSearchTarget, restoreSearchTarget, withSearchDeletion } from "./search-index-delete-runtime";
import type { SearchIndexFixture } from "./search-index-fixture";

export async function searchDocumentCapacity(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "document-capacity");
  for (let offset = 0; offset < 9992; offset += 500) {
    await client.note.createMany({ data: Array.from({ length: Math.min(500, 9992 - offset) }, (_, index) => ({ ownerUserId: data.owner.id,
      subjectId: data.subject.id, title: `SEARCH capacity ${offset + index}`, content: "" })) });
  }
  await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
  assert.equal(await client.workspaceSearchDocument.count({ where: { workspaceId: data.workspace.id } }), 10000);
  await client.note.create({ data: { ownerUserId: data.owner.id, subjectId: data.subject.id, title: "SEARCH over capacity", content: "" } });
  await assert.rejects(requestSearchCase(client, data), /DOCUMENT_LIMIT/);
  const fallback = await querySearchCase(data); assert.equal(fallback.indexed, false); assert.equal(fallback.truncated, true);
  assert.equal(await client.workspaceSearchDocument.count({ where: { workspaceId: data.workspace.id } }), 10000);
}

export async function searchTitleCapacity(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "title-capacity"); const title = "中".repeat(2730) + "aa";
  assert.equal(Buffer.byteLength(title), 8192);
  await client.note.update({ where: { id: data.own.note.id }, data: { title } });
  await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
  await client.note.update({ where: { id: data.own.note.id }, data: { title: title + "x" } });
  const job = await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["FAILED"]);
  assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).errorCode, "SEARCH_INDEX_TITLE_LIMIT");
  const result = await querySearchCase(data, data.owner, "中中"); assert.equal(result.indexed, false); assert.equal(result.results[0]!.label.length, 240);
}

export async function searchTotalTitleCapacity(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "total-title-capacity");
  const originalBytes = [data.subject.name, ...Object.values(data.own).map(row => row.title), data.foreign.note.title, data.foreign.mistake.title]
    .reduce((sum, title) => sum + Buffer.byteLength(title), 0);
  let remaining = 16 * 1024 * 1024 - originalBytes; let last = { id: "", title: "" };
  while (remaining > 0) {
    const batch = [];
    for (let index = 0; index < 250 && remaining > 0; index++) {
      const size = Math.min(8192, remaining); remaining -= size;
      last = { id: randomUUID(), title: "x".repeat(size) };
      batch.push({ ...last, ownerUserId: data.owner.id, subjectId: data.subject.id, content: "" });
    }
    await client.note.createMany({ data: batch });
  }
  await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
  assert.ok(Buffer.byteLength(last.title) < 8192);
  await client.note.update({ where: { id: last.id }, data: { title: last.title + "x" } });
  const job = await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["FAILED"]);
  assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).errorCode, "SEARCH_INDEX_TITLE_LIMIT");
  assert.equal((await querySearchCase(data)).indexed, false);
}

export async function searchGrantAndFenceCapacity(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "grant-capacity"); const grantIds: string[] = [];
  const queued = await requestSearchCase(client, data);
  for (let offset = 0; offset < 10001; offset += 500) {
    const rows = Array.from({ length: Math.min(500, 10001 - offset) }, (_, index) => ({ id: randomUUID(), ownerUserId: data.member.id,
      subjectId: data.subject.id, title: `SEARCH bulk ${offset + index}`, content: "", updatedAt: new Date(1_700_000_000_000 + offset + index) }));
    await client.note.createMany({ data: rows });
    const grants = rows.map(row => ({ id: randomUUID(), resourceId: row.id, workspaceId: data.workspace.id, resourceType: "NOTE" as const,
      scope: "WORKSPACE" as const, access: "VIEW" as const, resourceOwnerUserId: data.member.id, grantedByUserId: data.member.id }));
    grantIds.push(...grants.map(row => row.id)); await client.workspaceShareGrant.createMany({ data: grants });
  }
  await assert.rejects(requestSearchCase(client, data), /GRANT_LIMIT/);
  const cancelled = await controlWorkspaceSearchIndex(client, { actorId: data.owner.id, sessionId: data.owner.sessionId,
    workspaceId: data.workspace.id, jobId: queued.id, expectedRevision: queued.revision, action: "CANCEL" });
  assert.equal(cancelled.status, "CANCELLED");
  for (const enabled of ["true", "false"]) {
    process.env.SEARCH_INDEX_ENABLED = enabled;
    const result = await querySearchCase(data); assert.equal(result.indexed, false); assert.equal(result.truncated, true);
    // 此 grant 的源排序早于其余万条，落在 limit+1 之外；直查不得先锁整张授权集合。
    await withSearchLock(client, tx => tx.$queryRaw`SELECT id FROM "WorkspaceShareGrant" WHERE id=${grantIds[0]} FOR UPDATE`, async () => {
      assert.equal((await querySearchCase(data)).results.length, 30);
    });
  }
  process.env.SEARCH_INDEX_ENABLED = "true";
  await withSearchDeletion(async () => {
    const intent = await freezeSearchTarget(client, data.member, { requesterId: data.member.id, scope: "ACCOUNT", workspaceId: null, resourceType: null, resourceId: null });
    try {
      assert.ok(await client.dataDeletionFence.count({ where: { intentId: intent.id } }) > 20000);
      for (const enabled of ["true", "false"]) {
        process.env.SEARCH_INDEX_ENABLED = enabled;
        const result = await querySearchCase(data); assert.equal(result.indexed, false); assert.equal(result.results.length, 6);
        assert.ok(result.results.every(row => row.visibility !== "SHARED"));
      }
    } finally { process.env.SEARCH_INDEX_ENABLED = "true"; await restoreSearchTarget(client, data.member, intent.id); }
  });
}
