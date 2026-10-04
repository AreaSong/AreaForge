import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, type PrismaClient } from "../../packages/db/src/index";
import { claimDatabaseDeletion } from "../../packages/db/src/data-delete-lease";
import { createNote } from "../../apps/web/lib/study/notes-service";
import { deleteClock } from "../../packages/db/src/data-delete-intents";
import { executeDatabaseDeletion } from "../workers/data-delete-worker";
import { deletionCase, freeze, eligible, fileIdentity, uploadPath, storageDeletionEvidence, type DeletionData } from "./storage-quota-deletion-data";
import { seedStorageFile, storageUsedBytes } from "./storage-quota-runtime-data";
import type { StorageQuotaFixture } from "./storage-quota-fixture";
const roots = (fixture: StorageQuotaFixture) => ({ uploadRoot: fixture.root + "/uploads", exportRoot: fixture.root + "/exports" });

export async function storageExpiredLease(client: PrismaClient, fixture: StorageQuotaFixture) {
  const target = await deletionCase(client, fixture); const peer = await deletionCase(client, fixture);
  const targetIntent = await freeze(client, target); const peerIntent = await freeze(client, peer);
  await eligible(client, targetIntent.id); await eligible(client, peerIntent.id);
  const oldLease = await claimDatabaseDeletion(client, "storage-expire-" + randomUUID(), targetIntent.id); assert.ok(oldLease);
  const peerLease = await claimDatabaseDeletion(client, "storage-peer-" + randomUUID(), peerIntent.id); assert.ok(peerLease);
  const peerBefore = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: peerIntent.id } });
  // 真实数据库时钟自然到期，不改租约、文件阶段或全局时间。
  for (;;) {
    const now = await deleteClock(client);
    if (now >= peerBefore.leaseExpiresAt!) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(500, peerBefore.leaseExpiresAt!.getTime() - now.getTime() + 10)));
  }
  assert.equal((await executeDatabaseDeletion(client, oldLease, roots(fixture))).state, "LEASE_LOST");
  assert.deepEqual(await client.attachment.findUniqueOrThrow({ where: { id: target.attachment.id } }), target.attachment);
  assert.equal(await storageUsedBytes(client, target.workspace.id), BigInt(target.attachment.sizeBytes));
  const lease = await claimDatabaseDeletion(client, "storage-reclaim-" + randomUUID(), targetIntent.id); assert.ok(lease);
  assert.deepEqual(await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: peerIntent.id } }), peerBefore);
  assert.equal((await executeDatabaseDeletion(client, lease, roots(fixture))).state, "SUCCEEDED");
  assert.deepEqual(await client.attachment.findUniqueOrThrow({ where: { id: peer.attachment.id } }), peer.attachment);
  assert.deepEqual(await client.dataDeletionIntent.findUniqueOrThrow({ where: { id: peerIntent.id } }), peerBefore);
  storageDeletionEvidence.push({ event: "natural-lease-expiry-and-scoped-reclaim", intentId: targetIntent.id,
    preservedIntentId: peerIntent.id, oldVersion: oldLease.version, newVersion: lease.version, occupiedBeforeCommit: true });
}
export async function storageResourceClosure(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await deletionCase(client, fixture, "StudyResource"); const identity = await fileIdentity(uploadPath(fixture, data));
  const intent = await freeze(client, data);
  assert.equal(await client.dataDeletionItem.count({ where: { intentId: intent.id, model: "Attachment" } }), 0);
  await eligible(client, intent.id);
  const lease = await claimDatabaseDeletion(client, "storage-resource-" + randomUUID(), intent.id); assert.ok(lease);
  assert.equal((await executeDatabaseDeletion(client, lease, roots(fixture))).state, "SUCCEEDED");
  assert.equal(await client.studyResource.count({ where: { id: data.target.resourceId! } }), 0);
  assert.deepEqual(await client.attachment.findUniqueOrThrow({ where: { id: data.attachment.id } }), data.attachment);
  assert.deepEqual(await fileIdentity(uploadPath(fixture, data)), identity);
  assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(data.attachment.sizeBytes));
  storageDeletionEvidence.push({ event: "resource-closure-retains-attachment", intentId: intent.id, occupiedBytes: data.attachment.sizeBytes });
}
export async function storageDeletionScope(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await deletionCase(client, fixture);
  const ownNote = await client.note.create({ data: { subjectId: data.subject.id, ownerUserId: data.owner.id, title: "合成保留对象", content: "SYNTHETIC" } });
  const other = await seedStorageFile(client, fixture, data, { noteId: ownNote.id });
  const member = await seedStorageFile(client, fixture, data, { actor: data.member, noteId: data.memberNote.id });
  const secondary = await seedStorageFile(client, fixture, { ...data, ...data.secondary });
  const retained = [other, member, secondary];
  const identities = await Promise.all(retained.map(row => fileIdentity(fixture.root + "/uploads/" + row.storedName)));
  const intent = await freeze(client, data); await eligible(client, intent.id);
  const lease = await claimDatabaseDeletion(client, "storage-scope-" + randomUUID(), intent.id); assert.ok(lease);
  assert.equal((await executeDatabaseDeletion(client, lease, roots(fixture))).state, "SUCCEEDED");
  for (const [index, row] of retained.entries()) {
    assert.deepEqual(await client.attachment.findUniqueOrThrow({ where: { id: row.id } }), row);
    assert.deepEqual(await fileIdentity(fixture.root + "/uploads/" + row.storedName), identities[index]);
  }
  assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(other.sizeBytes + member.sizeBytes));
  assert.equal(await storageUsedBytes(client, data.secondary.workspace.id), BigInt(secondary.sizeBytes));
  storageDeletionEvidence.push({ event: "closure-isolation", intentId: intent.id, preservedAttachments: retained.map(row => row.id),
    sameBucketOtherOwnerPreserved: true, sameOwnerOtherObjectPreserved: true, otherWorkspacePreserved: true });
}

export async function storageRequiredRelationVisibility(client: PrismaClient, fixture: StorageQuotaFixture,
  onFrozen?: (data: DeletionData, intentId: string) => void) {
  const data = await deletionCase(client, fixture, "StudyResource");
  await client.studyResourceNoteLink.create({ data: { resourceId: data.target.resourceId!, noteId: data.note.id } });
  const intent = await freeze(client, data);
  onFrozen?.(data, intent.id);
  const shown = await prisma.note.findUniqueOrThrow({ where: { id: data.note.id, ownerUserId: data.owner.id },
    select: { title: true, studyResourceLinks: { take: 1, include: { resource: { select: { title: true } } } },
      _count: { select: { studyResourceLinks: true } } } });
  assert.equal(shown.studyResourceLinks.length, 0); assert.equal(shown._count.studyResourceLinks, 0);
  assert.equal("id" in shown, false);
  const created = await createNote({ subjectId: data.subject.id, title: "冻结期间合成新笔记", content: "SYNTHETIC", idempotencyKey: randomUUID() }, data.owner.id);
  assert.ok(created.id); assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(data.attachment.sizeBytes));
  storageDeletionEvidence.push({ event: "required-relation-visibility", intentId: intent.id, hiddenLinks: true, count: 0, unrelatedMutationAllowed: true });
}
