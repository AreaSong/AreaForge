import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../../packages/db/src/index";
import type { StorageQuotaFixture } from "./storage-quota-fixture";
import { createStorageCase, seedStorageFile, storagePdfBytes, storageScan, storageUsedBytes, uploadStorageNote, withStoragePolicy } from "./storage-quota-runtime-data";
import { stageWorkspaceAttachment, markUnboundAttachmentDiscarded, cleanupDiscardedAttachmentFiles, getAttachmentDownload } from "../../apps/web/lib/study/attachments-service";
import { stageStudyResourceUploadBatch, resolveStudyResourceUpload } from "../../apps/web/lib/study/study-resource-service";

export async function storageNoteQuota(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "note-quota"); const key = randomUUID();
  await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: String(storagePdfBytes.length) }, async () => {
    const first = await uploadStorageNote(data, key); const repeated = await uploadStorageNote(data, key);
    assert.equal(repeated.id, first.id); assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(storagePdfBytes.length));
    await assert.rejects(uploadStorageNote(data), { code: "WORKSPACE_STORAGE_QUOTA_LIMIT", status: 429 });
    assert.equal(await client.attachment.count({ where: { ownerUserId: data.owner.id } }), 1);
    const download = await getAttachmentDownload(first.id, "attachment", data.owner.id); assert.deepEqual(Buffer.from(download.bytes), storagePdfBytes);
    await assert.rejects(getAttachmentDownload(first.id, "attachment", data.outsider.id), { status: 404 });
    assert.doesNotMatch(JSON.stringify(first), /storageWorkspaceId|storageReleasedAt|storageReleaseProof|storedName/);
    assert.equal(JSON.stringify(first).includes("upload://"), false);
  });
}

export async function storageRejectedClaim(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "rejected-claim"); const key = randomUUID();
  await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "0" }, async () => {
    await assert.rejects(uploadStorageNote(data, key), { code: "WORKSPACE_STORAGE_QUOTA_LIMIT" });
    assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "NOTE_ATTACHMENT_UPLOAD_COMMAND" } }), 0);
    assert.equal(await client.attachment.count({ where: { ownerUserId: data.owner.id } }), 0);
  });
  assert.ok((await uploadStorageNote(data, key)).id);
}

export async function storageWorkspaceBudgets(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "workspace-budgets");
  await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: String(storagePdfBytes.length) }, async () => {
    // 存量可来自成员；既有上传入口的 owner-only 语义不因配额而扩权。
    await seedStorageFile(client, fixture, data, { actor: data.member, noteId: data.memberNote.id });
    await assert.rejects(uploadStorageNote(data), { code: "WORKSPACE_STORAGE_QUOTA_LIMIT" });
    await assert.rejects(uploadStorageNote(data, randomUUID(), data.member, data.memberNote.id), { code: "ACTIVE_WORKSPACE_NOT_FOUND", status: 404 });
    await client.workspaceSelection.update({ where: { userId: data.owner.id }, data: { workspaceId: data.secondary.workspace.id } });
    assert.ok((await uploadStorageNote(data, randomUUID(), data.owner, data.secondary.note.id)).id);
    assert.equal(await storageUsedBytes(client, data.secondary.workspace.id), BigInt(storagePdfBytes.length));
  });
}

export async function storageResourceDecisions(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "resource-decisions");
  await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: String(storagePdfBytes.length * 2) }, async () => {
    const first = (await stageStudyResourceUploadBatch(data.owner.id, [storageScan()], randomUUID()))[0]!;
    assert.equal(first.error, null); assert.ok(first.staging);
    const copied = await resolveStudyResourceUpload(data.owner.id, { attachmentId: first.staging.attachment.id, decision: "copy", title: "存储副本" });
    assert.ok("id" in copied);
    assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(storagePdfBytes.length));
    const next = (await stageStudyResourceUploadBatch(data.owner.id, [storageScan()], randomUUID()))[0]!;
    assert.ok(next.staging); assert.ok(next.staging.duplicates.some(row => row.resourceId === copied.id));
    const input = { attachmentId: next.staging.attachment.id, decision: "reuse" as const, reuseResourceId: copied.id };
    assert.equal((await resolveStudyResourceUpload(data.owner.id, input) as { id: string }).id, copied.id);
    assert.equal((await resolveStudyResourceUpload(data.owner.id, input) as { id: string }).id, copied.id);
    const released = await client.attachment.findUniqueOrThrow({ where: { id: input.attachmentId } });
    assert.ok(released.storageReleasedAt); assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(storagePdfBytes.length));
    const third = (await stageStudyResourceUploadBatch(data.owner.id, [storageScan()], randomUUID()))[0]!;
    assert.ok(third.staging);
    assert.deepEqual(await resolveStudyResourceUpload(data.owner.id, { attachmentId: third.staging.attachment.id, decision: "skip" }), { skipped: true });
    assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(storagePdfBytes.length));
  });
}

export async function storageCleanupRetry(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "cleanup-retry");
  const attachment = await stageWorkspaceAttachment({ scan: storageScan() }, data.owner.id);
  const cleanup = await markUnboundAttachmentDiscarded(data.owner.id, attachment.id); assert.ok(cleanup);
  assert.equal(await cleanupDiscardedAttachmentFiles(cleanup, { beforeUnlink: async () => { throw new Error("SYNTHETIC_CLEANUP_FAILURE"); } }), false);
  assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(storagePdfBytes.length));
  const retry = await markUnboundAttachmentDiscarded(data.owner.id, attachment.id); assert.ok(retry);
  assert.equal(await cleanupDiscardedAttachmentFiles(retry), true);
  assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(0));
  const row = await client.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
  const file = path.join(fixture.root, "uploads", row.storedName);
  await writeFile(file, storagePdfBytes, { flag: "wx", mode: 0o600 });
  try {
    await assert.rejects(uploadStorageNote(data), { code: "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN" });
    assert.equal(await cleanupDiscardedAttachmentFiles(retry), false);
    assert.deepEqual(await readFile(file), storagePdfBytes);
  } finally { await unlink(file); }
}

export async function storageDisabledAndInvalid(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "disabled-invalid");
  await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_ENABLED: "false", WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "bad" }, async () => { assert.ok((await uploadStorageNote(data)).id); });
  const key = randomUUID();
  await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "bad" }, async () => {
    await assert.rejects(uploadStorageNote(data, key), { code: "WORKSPACE_STORAGE_QUOTA_CONFIG_INVALID" });
    assert.equal(await client.attachment.count({ where: { ownerUserId: data.owner.id } }), 1);
  });
  assert.ok((await uploadStorageNote(data, key)).id);
}
