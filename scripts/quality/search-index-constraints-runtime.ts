import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type PrismaClient } from "../../packages/db/src/index";
import { createSearchCase, requestSearchCase, consumeSearchCase, querySearchCase } from "./search-index-runtime-data";
import { eraseSearchTarget, freezeSearchTarget, restoreSearchTarget, withSearchDeletion } from "./search-index-delete-runtime";
import type { SearchIndexFixture } from "./search-index-fixture";

export async function searchSourceConstraints(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "constraints"); await requestSearchCase(client, data);
  assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
  const document = await client.workspaceSearchDocument.findFirstOrThrow({ where: { noteId: data.own.note.id } });
  const base = { ...document, id: randomUUID(), generation: 99 };
  for (const change of [{ noteId: null }, { mistakeId: data.own.mistake.id }, { kind: "TASK" }, { sourceId: data.foreign.note.id }, { workspaceId: data.secondary.id }]) {
    await assert.rejects(client.workspaceSearchDocument.create({ data: { ...base, ...change } }));
  }
  assert.equal(await client.workspaceSearchDocument.count({ where: { workspaceId: data.workspace.id } }), 8);
  await withSearchDeletion(async () => {
    const intent = await freezeSearchTarget(client, data.owner, { requesterId: data.owner.id, scope: "RESOURCE", workspaceId: data.workspace.id, resourceType: "Note", resourceId: data.own.note.id });
    try { await assert.rejects(client.workspaceSearchDocument.create({ data: base })); }
    finally { await restoreSearchTarget(client, data.owner, intent.id); }
    await requestSearchCase(client, data, data.viewer); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
    const partition = await client.workspaceSearchPartition.findUniqueOrThrow({ where: { userId_workspaceId: { userId: data.viewer.id, workspaceId: data.workspace.id } } });
    const parent = await freezeSearchTarget(client, data.viewer, { requesterId: data.viewer.id, scope: "ACCOUNT", workspaceId: null, resourceType: null, resourceId: null });
    try {
      await assert.rejects(client.workspaceSearchDocument.create({ data: { ...base, partitionId: partition.id } }));
      await assert.rejects(client.workspaceSearchDocument.update({ where: { id: document.id }, data: { partitionId: partition.id, generation: 99 } }));
    } finally { await restoreSearchTarget(client, data.viewer, parent.id); }
  });
}

export async function searchTypedSourceIdentity(client: PrismaClient, fixture: SearchIndexFixture) {
  await withSearchDeletion(async () => {
    const data = await createSearchCase(client, fixture, "same-id"); const id = randomUUID();
    await client.note.create({ data: { id, ownerUserId: data.owner.id, subjectId: data.subject.id, title: "SEARCH same id note", content: "" } });
    await client.mistake.create({ data: { id, ownerUserId: data.owner.id, subjectId: data.subject.id, title: "SEARCH same id mistake" } });
    await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
    assert.equal(await client.workspaceSearchDocument.count({ where: { sourceId: id } }), 2);
    const intent = await freezeSearchTarget(client, data.owner, { requesterId: data.owner.id, scope: "RESOURCE", workspaceId: data.workspace.id, resourceType: "Note", resourceId: id });
    await eraseSearchTarget(client, fixture, intent.id);
    assert.deepEqual((await client.workspaceSearchDocument.findMany({ where: { sourceId: id } })).map(row => row.kind), ["MISTAKE"]);
    assert.ok(await client.mistake.findUnique({ where: { id } }));
  });
}

export async function searchWorkspaceDeletion(client: PrismaClient, fixture: SearchIndexFixture) {
  await withSearchDeletion(async () => {
    const data = await createSearchCase(client, fixture, "workspace-delete");
    const secondary = { ...data, workspace: data.secondary };
    await requestSearchCase(client, secondary); assert.deepEqual(await consumeSearchCase(client, secondary), ["SUCCEEDED"]);
    const intent = await freezeSearchTarget(client, data.owner, { requesterId: data.owner.id, scope: "WORKSPACE", workspaceId: data.secondary.id, resourceType: null, resourceId: null });
    await eraseSearchTarget(client, fixture, intent.id);
    assert.equal(await client.subject.findUnique({ where: { id: data.secondarySubject.id } }), null);
    assert.equal(await client.workspaceSearchDocument.count({ where: { workspaceId: data.secondary.id } }), 0);
    assert.equal((await querySearchCase(data)).results.length, 8);
  });
}
