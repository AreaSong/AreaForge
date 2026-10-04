import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../../packages/db/src/index";
import { withDeletionVisibility } from "../../packages/db/src/data-delete-visibility";
import { controlDatabaseDeletion } from "../../packages/db/src/data-delete-intents";
import { deletionCase, freeze, priorState, assertPriorState, fileIdentity, uploadPath, type DeletionData } from "./storage-quota-deletion-data";
import { storageRequiredRelationVisibility } from "./storage-quota-deletion-scope-runtime";
import type { StorageQuotaFixture } from "./storage-quota-fixture";
import { storageOmitCases } from "./storage-quota-evidence";

type Check = (name: string, run: () => Promise<void>) => Promise<void>;
export const storageOmitEvidence: object[] = [];
const omit = { id: true, content: true } as const;
function absent(row: object, ...fields: string[]) { for (const field of fields) assert.equal(Object.hasOwn(row, field), false, "unexpected field: " + field); }
async function unchanged<T>(args: T, run: (args: T) => Promise<unknown>) {
  const before = structuredClone(args); const result = await run(args); assert.deepEqual(args, before); return result;
}
async function restore(client: PrismaClient, data: DeletionData, id: string) {
  const row = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id } });
  assert.equal((await controlDatabaseDeletion(client, { actor: data.actor, intentId: id, expectedRevision: row.revision, action: "restore" })).state, "RESTORED");
}

async function projections(raw: PrismaClient, visible: PrismaClient, data: DeletionData) {
  const where = { id: data.note.id, ownerUserId: data.owner.id, subject: { workspaceId: data.workspace.id } };
  for (const projection of [{ omit: { id: true } }, { omit: { content: true } }, { omit },
    { omit: { id: false, content: false } }, {}, { select: { title: true, content: true } }] as const) {
    const args: Prisma.NoteFindUniqueArgs = { where, ...projection };
    assert.deepEqual(await unchanged(args, a => visible.note.findUnique(a)), await raw.note.findUnique(args));
    assert.deepEqual(await unchanged(args, a => visible.note.findMany(a)), await raw.note.findMany(args));
  }
  const nested = { where, omit, include: { attachments: { omit: { id: true, uri: true, storedName: true } }, subject: { omit: { id: true, stableKey: true } } } } as const;
  assert.deepEqual(await unchanged(nested, a => visible.note.findUnique(a)), await raw.note.findUnique(nested));
  const mixed = { where, select: { title: true, attachments: { omit: { id: true, uri: true } } } } as const;
  assert.deepEqual(await unchanged(mixed, a => visible.note.findUnique(a)), await raw.note.findUnique(mixed));
  // 不使用同层 select+omit；客户端没有全局 omit 配置。
  storageOmitEvidence.push({ case: "native-projection-equivalence", prisma: Prisma.prismaVersion.client, nativeComparisons: 14,
    noFrozenObjectsInSelectedScope: true, globalHistoricalFencesRetained: true, inputsUnchanged: true });
}

async function scopeQueries(raw: PrismaClient, visible: PrismaClient, data: DeletionData) {
  const where = { ownerUserId: data.owner.id, subject: { workspaceId: data.workspace.id } };
  const peer = await raw.note.create({ data: { subjectId: data.subject.id, ownerUserId: data.owner.id, title: "VISIBLE_PEER", content: "SYNTHETIC" } });
  const args = { where, omit, orderBy: { createdAt: "asc" as const }, take: 1 };
  const rows = await unchanged(args, a => visible.note.findMany(a));
  assert.deepEqual(rows, await raw.note.findMany({ ...args, where: { ...where, id: { not: data.note.id } } }));
  assert.equal((rows as object[]).length, 1); absent((rows as object[])[0]!, "id", "content");
  assert.equal(await visible.note.findUnique({ where: { id: data.note.id }, omit }), null);
  assert.equal(await visible.note.count({ where }), 1);
  const parent = await visible.subject.findUniqueOrThrow({ where: { id: data.subject.id }, omit: { id: true },
    include: { notes: { where: { ownerUserId: data.owner.id }, omit, take: 1, orderBy: { createdAt: "asc" } },
      _count: { select: { notes: { where: { ownerUserId: data.owner.id } } } } } });
  assert.equal(parent.notes.length, 1); assert.equal(parent.notes[0]!.title, peer.title); assert.equal(parent._count.notes, 1);
  absent(parent, "id"); absent(parent.notes[0]!, "id", "content");
  for (const note of [peer, data.memberNote, data.secondary.note]) {
    const q = { where: { id: note.id, ownerUserId: note.ownerUserId }, omit };
    assert.deepEqual(await visible.note.findUnique(q), await raw.note.findUnique(q));
  }
  assert.equal(await visible.note.findUnique({ where: { id: peer.id, ownerUserId: data.member.id }, omit }), null);
  assert.equal(await visible.note.findUnique({ where: { id: peer.id, subject: { workspaceId: data.secondary.workspace.id } }, omit }), null);
}

async function relations(raw: PrismaClient, visible: PrismaClient, data: DeletionData) {
  const other = await raw.studyResource.create({ data: { ownerUserId: data.owner.id, workspaceId: data.workspace.id,
    stableKey: randomUUID(), title: "VISIBLE_RESOURCE", sourceType: "LINK", externalUrl: "https://example.test/synthetic", displayHost: "example.test" } });
  await raw.studyResourceNoteLink.create({ data: { resourceId: other.id, noteId: data.note.id } });
  const args = { where: { id: data.note.id, ownerUserId: data.owner.id, subject: { workspaceId: data.workspace.id } }, omit,
    include: { studyResourceLinks: { take: 1, orderBy: { createdAt: "asc" as const }, omit: { id: true },
      include: { resource: { omit: { id: true, stableKey: true } } } }, _count: { select: { studyResourceLinks: true } } } } as const;
  const row = await visible.note.findUniqueOrThrow(args);
  assert.equal(row.studyResourceLinks.length, 1); assert.equal(row.studyResourceLinks[0]!.resource.title, other.title);
  assert.equal(row._count.studyResourceLinks, 1);
  absent(row, "id", "content"); absent(row.studyResourceLinks[0]!, "id"); absent(row.studyResourceLinks[0]!.resource, "id", "stableKey");
  const required = await visible.studyResourceNoteLink.findMany({ where: { noteId: data.note.id, resource: { ownerUserId: data.owner.id, workspaceId: data.workspace.id } },
    take: 1, omit: { id: true }, include: { resource: { omit: { id: true, stableKey: true } } } });
  assert.equal(required.length, 1); assert.equal(required[0]!.resource.title, other.title);
  const optional = await visible.attachment.findUniqueOrThrow({ where: { id: data.attachment.id }, omit: { id: true, uri: true },
    include: { studyResource: { omit: { id: true, stableKey: true } } } });
  assert.equal(optional.studyResource, null); absent(optional, "id", "uri");
  const nullRelation = await visible.attachment.findMany({ where: { id: data.attachment.id, studyResource: { is: null } }, omit: { id: true } });
  assert.equal(nullRelation.length, 1);
}

async function mutations(raw: PrismaClient, visible: PrismaClient, data: DeletionData) {
  const id = randomUUID(); const createArgs = { data: { id, subjectId: data.subject.id, ownerUserId: data.owner.id, title: "MUTATION", content: "SYNTHETIC" }, omit };
  const created = await unchanged(createArgs, a => visible.note.create(a)); absent(created as object, "id", "content");
  assert.equal(await raw.note.count({ where: { id } }), 1);
  const updated = await visible.note.update({ where: { id }, data: { revision: { increment: 1 } }, omit, include: { subject: { omit: { id: true } } } });
  assert.equal(updated.revision, 2); absent(updated, "id", "content"); absent(updated.subject, "id");
  const upserted = await visible.note.upsert({ where: { id }, create: createArgs.data, update: { revision: { increment: 1 } }, omit });
  absent(upserted, "id", "content"); assert.equal((await raw.note.findUniqueOrThrow({ where: { id } })).revision, 3);
  storageOmitEvidence.push({ case: "mutation-single-execution", id, rows: 1, revision: 3, create: 1, update: 1, upsertUpdate: 1 });
}

async function transactions(raw: PrismaClient, visible: PrismaClient, data: DeletionData) {
  const id = randomUUID();
  const interactive = await visible.$transaction(async tx => {
    const row = await tx.note.create({ data: { id, subjectId: data.subject.id, ownerUserId: data.owner.id, title: "TX", content: "SYNTHETIC" }, omit });
    absent(row, "id", "content");
    return tx.note.findUniqueOrThrow({ where: { id }, omit, include: { subject: { select: { name: true } } } });
  });
  absent(interactive, "id", "content"); absent(interactive.subject, "id");
  const batch = await visible.$transaction([
    visible.note.update({ where: { id }, data: { revision: { increment: 1 } }, omit }),
    visible.note.findUniqueOrThrow({ where: { id }, select: { title: true } }),
    visible.note.count({ where: { id } }),
  ]);
  absent(batch[0], "id", "content"); assert.deepEqual(batch[1], { title: "TX" }); assert.equal(batch[2], 1);
  assert.equal((await raw.note.findUniqueOrThrow({ where: { id } })).revision, 2);
}

async function generationRace(raw: PrismaClient, data: DeletionData, mutation: boolean) {
  let queries = 0; let intentId = "";
  const visible = withDeletionVisibility(raw, { afterQuery: async event => {
    if (event.model !== "Note" || event.operation !== (mutation ? "update" : "findUnique")) return;
    queries++;
    if (queries === 1) intentId = (await freeze(raw, data)).id;
  } });
  try {
    if (mutation) {
      const before = await raw.note.findUniqueOrThrow({ where: { id: data.note.id } });
      await assert.rejects(visible.note.update({ where: { id: data.note.id }, data: { revision: { increment: 1 } }, omit }), { code: "DATA_DELETE_READ_BUSY" });
      assert.equal(queries, 1);
      assert.equal((await raw.note.findUniqueOrThrow({ where: { id: data.note.id } })).revision, before.revision + 1);
    } else {
      assert.equal(await visible.note.findUnique({ where: { id: data.note.id }, omit }), null); assert.equal(queries, 2);
    }
    storageOmitEvidence.push({ case: mutation ? "generation-mutation-committed-response-rejected" : "generation-read-retry", queries,
      deterministicBarrier: "real query resolved -> controlled freeze committed -> normal snapshot recheck", mutationCommitted: mutation, automaticWriteReplay: false });
  } finally { if (intentId) await restore(raw, data, intentId); }
}

async function requiredConsumer(raw: PrismaClient, fixture: StorageQuotaFixture, failAfterFreeze = false) {
  const registered: Array<{ data: DeletionData; id: string }> = [];
  try {
    await storageRequiredRelationVisibility(raw, fixture, (data, id) => {
      registered.push({ data, id });
      if (failAfterFreeze) throw new Error("STORAGE_OMIT_OBSERVER_FAILURE");
    });
  } finally {
    for (const row of registered) {
      await restore(raw, row.data, row.id);
      assert.equal(await raw.dataDeletionFence.count({ where: { intentId: row.id } }), 0);
      assert.equal((await raw.dataDeletionIntent.findUniqueOrThrow({ where: { id: row.id } })).state, "RESTORED");
    }
  }
}

export async function runStorageOmitMatrix(raw: PrismaClient, fixture: StorageQuotaFixture, check: Check) {
  const before = await priorState(raw, fixture); const visible = withDeletionVisibility(raw);
  const priorFences = await raw.dataDeletionFence.count();
  const data = await deletionCase(raw, fixture); const resource = await deletionCase(raw, fixture, "StudyResource");
  await raw.studyResourceNoteLink.create({ data: { resourceId: resource.target.resourceId!, noteId: resource.note.id } });
  const identities = await Promise.all([data, resource].map(d => fileIdentity(uploadPath(fixture, d))));
  let noteIntent = ""; let resourceIntent = "";
  try {
    await check(storageOmitCases[0]!, () => projections(raw, visible, data));
    noteIntent = (await freeze(raw, data)).id; resourceIntent = (await freeze(raw, resource)).id;
    await check(storageOmitCases[1]!, () => scopeQueries(raw, visible, data));
    await check(storageOmitCases[2]!, () => relations(raw, visible, resource));
    await check(storageOmitCases[3]!, () => projections(raw, visible, { ...data, note: data.secondary.note, subject: data.secondary.subject, workspace: data.secondary.workspace }));
    await check(storageOmitCases[4]!, () => mutations(raw, visible, resource));
    await check(storageOmitCases[5]!, () => transactions(raw, visible, resource));
    await check(storageOmitCases[6]!, async () => generationRace(raw, await deletionCase(raw, fixture), false));
    await check(storageOmitCases[7]!, async () => generationRace(raw, await deletionCase(raw, fixture), true));
    await check(storageOmitCases[8]!, async () => {
      await restore(raw, data, noteIntent); noteIntent = ""; await restore(raw, resource, resourceIntent); resourceIntent = "";
      await projections(raw, visible, data);
      const args = { where: { id: resource.attachment.id }, omit: { id: true, uri: true }, include: { studyResource: { omit: { id: true, stableKey: true } } } } as const;
      const row = await visible.attachment.findUniqueOrThrow(args); assert.ok(row.studyResource);
      absent(row.studyResource, "id", "stableKey"); assert.deepEqual(row, await raw.attachment.findUniqueOrThrow(args));
    });
    await check(storageOmitCases[9]!, () => requiredConsumer(raw, fixture));
    await check(storageOmitCases[10]!, async () => {
      await assert.rejects(requiredConsumer(raw, fixture, true), /STORAGE_OMIT_OBSERVER_FAILURE/);
    });
  } finally {
    if (noteIntent) await restore(raw, data, noteIntent);
    if (resourceIntent) await restore(raw, resource, resourceIntent);
    for (const [index, d] of [data, resource].entries()) {
      assert.deepEqual(await raw.attachment.findUniqueOrThrow({ where: { id: d.attachment.id } }), d.attachment);
      assert.deepEqual(await fileIdentity(uploadPath(fixture, d)), identities[index]);
    }
    const protection = await assertPriorState(raw, fixture, before);
    console.log(JSON.stringify({ event: "STORAGE_OMIT_PRIOR_PROTECTION", ...protection }));
  }
  // 6 对真实冻结/恢复，每个控制动作由数据库触发器推进一代。
  const protection = await assertPriorState(raw, fixture, before);
  assert.equal(BigInt(protection.visibilityAfter) - BigInt(protection.visibilityBefore), 12n);
  assert.equal(await raw.dataDeletionFence.count(), priorFences);
  return { ...protection, priorFencesUnchanged: priorFences, expectedVisibilityDelta: "12", cases: storageOmitEvidence, physicalDeletionExecuted: false,
    globalOmit: "not configured; out of scope", noFenceFastPath: "historical fences retained; selected objects initially unfrozen" };
}
