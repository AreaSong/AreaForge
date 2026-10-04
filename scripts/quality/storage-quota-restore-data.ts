import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type PrismaClient } from "../../packages/db/src/index";
import { claimDatabaseDeletion } from "../../packages/db/src/data-delete-lease";
import { executeDatabaseDeletion, type DataDeleteHooks } from "../workers/data-delete-worker";
import { createStorageAttachmentIntent, settleAttachmentStorageCleanup, storageCleanupDescriptor, storageCleanupSelect } from "../../apps/web/lib/study/attachment-storage-service";
import { deletionCase, eligible, freeze, type DeletionData } from "./storage-quota-deletion-data";
import { storageScan, seedStorageFile, storagePdfBytes } from "./storage-quota-runtime-data";
import { type StorageQuotaFixture } from "./storage-quota-fixture";

export function admissionInput(data: DeletionData) {
  const storedName = randomBytes(16).toString("hex") + ".pdf";
  return { noteId: data.note.id, workspaceId: data.workspace.id, actorId: data.owner.id, stagingName: storedName + ".staging",
    draft: { originalName: "storage-restore.pdf", storedName, mimeType: "application/pdf", sizeBytes: storagePdfBytes.length,
      hash: storageScan().sha256Hex, uri: "upload://attachment/" + storedName } };
}
export async function deleteCase(client: PrismaClient, fixture: StorageQuotaFixture, data: DeletionData, workspace = false, hooks: DataDeleteHooks = {}) {
  const intent = await freeze(client, data, workspace ? { ...data.target, scope: "WORKSPACE", resourceType: null, resourceId: null } : data.target);
  assert.equal(await claimDatabaseDeletion(client, "storage-restore-before-expiry", intent.id), null, "cooldown must refuse before fixture expiry");
  await eligible(client, intent.id);
  const lease = await claimDatabaseDeletion(client, "storage-restore-source", intent.id); assert.ok(lease);
  const result = await executeDatabaseDeletion(client, lease, { uploadRoot: fixture.root + "/uploads", exportRoot: fixture.root + "/exports" }, hooks);
  assert.equal(result.state, "SUCCEEDED"); return intent;
}
export async function seedRestoreCases(client: PrismaClient, fixture: StorageQuotaFixture) {
  assert.equal(await client.attachment.count(), 0, "restore source must be fresh"); assert.equal(await client.dataDeletionLedger.count(), 0);
  const baseline = await deletionCase(client, fixture); await deleteCase(client, fixture, baseline);
  const note = await deletionCase(client, fixture);
  const workspace = await deletionCase(client, fixture, "StudyResource", true);
  const resource = await deletionCase(client, fixture, "StudyResource");
  const keep = await deletionCase(client, fixture);
  const member = await seedStorageFile(client, fixture, keep, { actor: keep.member, noteId: keep.memberNote.id });
  const secondary = await seedStorageFile(client, fixture, { ...keep, ...keep.secondary });
  const frozen = await deletionCase(client, fixture); const frozenIntent = await freeze(client, frozen);
  const raceBase = await deletionCase(client, fixture);
  const raceNote = await client.note.create({ data: { ownerUserId: raceBase.owner.id, subjectId: raceBase.subject.id, title: "提交水位竞争", content: "SYNTHETIC_STORAGE_RACE" } });
  const driftNote = await client.note.create({ data: { ownerUserId: raceBase.owner.id, subjectId: raceBase.subject.id, title: "可信 head 漂移", content: "SYNTHETIC_STORAGE_DRIFT" } });
  const drift = { ...raceBase, note: driftNote, target: { ...raceBase.target, resourceId: driftNote.id } };
  const race = { ...raceBase, note: raceNote, target: { ...raceBase.target, resourceId: raceNote.id } };
  await mkdir(path.join(fixture.root, "uploads", ".staging"), { mode: 0o700 });
  const unsettled = [];
  for (const status of ["PENDING", "FAILED"] as const) {
    const input = admissionInput(keep);
    const row = await client.$transaction(tx => createStorageAttachmentIntent(tx, input), { isolationLevel: "Serializable" });
    await writeFile(path.join(fixture.root, "uploads", ".staging", input.stagingName), storagePdfBytes, { mode: 0o600, flag: "wx" });
    if (status === "FAILED") await client.attachment.update({ where: { id: row.id }, data: { status } });
    unsettled.push(row.id);
  }
  // 独立桶避免合成保留状态挤满 keep 的默认 256 bytes。
  const releasedData = await deletionCase(client, fixture);
  await client.attachment.update({ where: { id: releasedData.attachment.id }, data: { status: "FAILED" } });
  const cleanup = await client.attachment.findUniqueOrThrow({ where: { id: releasedData.attachment.id }, select: storageCleanupSelect });
  assert.equal(await client.$transaction(tx => settleAttachmentStorageCleanup(tx, storageCleanupDescriptor(cleanup), {}, { boundNote: true })), true);
  const registration = { baseline: baseline.attachment.id, note: note.attachment.id, workspace: workspace.attachment.id,
    resource: resource.attachment.id, keep: keep.attachment.id, member: member.id, secondary: secondary.id,
    frozen: frozen.attachment.id, frozenIntent: frozenIntent.id, raceNote: raceNote.id, driftNote: driftNote.id, unsettled, released: releasedData.attachment.id };
  await writeFile(path.join(fixture.root, ".stage-1b-3-objects.json"), JSON.stringify(registration), { mode: 0o600, flag: "wx" });
  return { baseline, note, workspace, resource, keep, frozen, race, drift, registration };
}
