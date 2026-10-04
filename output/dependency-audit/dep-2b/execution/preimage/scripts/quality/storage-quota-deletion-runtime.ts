import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createPrismaClient, prisma, checkWorkspaceStorageQuotaAdmission, type PrismaClient } from "../../packages/db/src/index";
import { DataDeleteError } from "../../packages/core/src/index";
import { previewDatabaseDeletion, controlDatabaseDeletion } from "../../packages/db/src/data-delete-intents";
import { claimDatabaseDeletion } from "../../packages/db/src/data-delete-lease";
import { commitDatabaseDeletion, verifyFrozenDeletePlan } from "../../packages/db/src/data-delete-commit";
import { executeDatabaseDeletion } from "../workers/data-delete-worker";
import { finalizeWorkspaceAttachment } from "../../apps/web/lib/study/attachments-service";
import { completeAttachmentStorageCleanup, storageCleanupDescriptor, storageCleanupSelect, withAttachmentFileOperation } from "../../apps/web/lib/study/attachment-storage-service";
import { reconcileNewProtocolAttachments } from "../../apps/web/lib/study/attachment-reconciliation-service";
import { deletionCase, eligible, freeze, fileIdentity, uploadPath, storageDeletionEvidence, type DeletionData } from "./storage-quota-deletion-data";
import { seedStorageFile, storageUsedBytes } from "./storage-quota-runtime-data";
import { storageExpiredLease, storageResourceClosure, storageDeletionScope, storageRequiredRelationVisibility } from "./storage-quota-deletion-scope-runtime";
import type { StorageQuotaFixture } from "./storage-quota-fixture";

type Check = (name: string, run: () => Promise<void>) => Promise<void>;
const roots = (fixture: StorageQuotaFixture) => ({ uploadRoot: fixture.root + "/uploads", exportRoot: fixture.root + "/exports" });
async function leaseFor(client: PrismaClient, id: string) {
  const lease = await claimDatabaseDeletion(client, "storage-delete-" + randomUUID(), id); assert.ok(lease); return lease;
}
async function verify(client: PrismaClient, id: string) {
  await client.$transaction(async tx => { await verifyFrozenDeletePlan(tx, await tx.dataDeletionIntent.findUniqueOrThrow({ where: { id } })); });
}
async function retained(client: PrismaClient, data: DeletionData) {
  assert.deepEqual(await client.attachment.findUniqueOrThrow({ where: { id: data.attachment.id } }), data.attachment);
  assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(data.attachment.sizeBytes));
  await assert.rejects(client.$transaction(tx => checkWorkspaceStorageQuotaAdmission(tx,
    { workspaceId: data.workspace.id, requestedBytes: 1 }, { env: { WORKSPACE_STORAGE_QUOTA_ENABLED: "true",
      WORKSPACE_STORAGE_QUOTA_MAX_BYTES: String(data.attachment.sizeBytes) }, verifyInventory: async () => { throw new Error("USAGE_WAS_OMITTED"); } }),
    { isolationLevel: "Serializable" }), { code: "WORKSPACE_STORAGE_QUOTA_LIMIT" });
}
async function control(client: PrismaClient, data: DeletionData, id: string, action: "restore" | "cancel" | "retry") {
  const row = await client.dataDeletionIntent.findUniqueOrThrow({ where: { id } });
  return controlDatabaseDeletion(client, { actor: data.actor, intentId: id, expectedRevision: row.revision, action });
}
async function frozenControls(client: PrismaClient, fixture: StorageQuotaFixture, kind: "Note" | "StudyResource") {
  const data = await deletionCase(client, fixture, kind); const identity = await fileIdentity(uploadPath(fixture, data));
  const frozen = await freeze(client, data); await retained(client, data); await verify(client, frozen.id);
  const visible = () => kind === "Note" ? prisma.note.findUnique({ where: { id: data.target.resourceId! } })
    : prisma.studyResource.findUnique({ where: { id: data.target.resourceId! } });
  assert.equal(await visible(), null);
  assert.equal(await claimDatabaseDeletion(client, "storage-too-early", frozen.id), null);
  await assert.rejects(finalizeWorkspaceAttachment(data.owner.id, data.attachment.id), { code: kind === "Note" ? "WORKSPACE_STORAGE_QUOTA_BUSY" : "ATTACHMENT_NOT_FOUND" });
  const cleanup = storageCleanupDescriptor(await client.attachment.findUniqueOrThrow({ where: { id: data.attachment.id }, select: storageCleanupSelect }));
  assert.equal(await completeAttachmentStorageCleanup(cleanup, {}, { boundNote: true }), false);
  await reconcileNewProtocolAttachments({ attachmentIds: [data.attachment.id], minIntentAgeMs: 0 });
  await retained(client, data); await verify(client, frozen.id);
  assert.deepEqual(await fileIdentity(uploadPath(fixture, data)), identity);
  assert.equal((await control(client, data, frozen.id, "restore")).state, "RESTORED");
  assert.ok(await visible());
  assert.equal(await client.dataDeletionFence.count({ where: { intentId: frozen.id } }), 0);
  await retained(client, data); assert.deepEqual(await fileIdentity(uploadPath(fixture, data)), identity);
  storageDeletionEvidence.push({ event: "freeze-restore", kind, intentId: frozen.id, usedBytes: data.attachment.sizeBytes, identityUnchanged: true });
}
async function cancelWorkspace(client: PrismaClient, fixture: StorageQuotaFixture) {
  const initial = await deletionCase(client, fixture);
  const attachment = await seedStorageFile(client, fixture, { ...initial, ...initial.secondary });
  const data = { ...initial, ...initial.secondary, attachment };
  const frozen = await freeze(client, data, { requesterId: data.owner.id, scope: "WORKSPACE", workspaceId: data.workspace.id, resourceType: null, resourceId: null });
  const identity = await fileIdentity(uploadPath(fixture, data));
  await retained(client, data); assert.equal(await claimDatabaseDeletion(client, "storage-too-early", frozen.id), null);
  assert.equal((await control(client, data, frozen.id, "cancel")).state, "CANCELLED");
  await retained(client, data); assert.deepEqual(await fileIdentity(uploadPath(fixture, data)), identity);
}
async function unsettled(client: PrismaClient, fixture: StorageQuotaFixture, status: "PENDING" | "FAILED") {
  const data = await deletionCase(client, fixture);
  await client.attachment.update({ where: { id: data.attachment.id }, data: { status } });
  const plan = await previewDatabaseDeletion(client, data.actor, data.target);
  assert.ok(plan.blockers.length > 0);
  await assert.rejects(freeze(client, data));
  assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(data.attachment.sizeBytes));
  assert.equal(await client.dataDeletionFence.count({ where: { model: "Attachment", keyJson: { path: ["id"], equals: data.attachment.id } } }), 0);
  storageDeletionEvidence.push({ event: "unsettled-refused", status, blockers: plan.blockers, occupied: true });
}
async function releasedNotEligible(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await deletionCase(client, fixture);
  const row = await client.attachment.update({ where: { id: data.attachment.id }, data: { status: "FAILED" }, select: storageCleanupSelect });
  assert.equal(await completeAttachmentStorageCleanup(storageCleanupDescriptor(row), {}, { boundNote: true }), true);
  assert.equal(await storageUsedBytes(client, data.workspace.id), 0n);
  const plan = await previewDatabaseDeletion(client, data.actor, data.target);
  assert.ok(plan.blockers.includes("DATA_DELETE_ATTACHMENT_UNSETTLED"));
  await assert.rejects(freeze(client, data));
}
async function pendingFiles(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await deletionCase(client, fixture); const frozen = await freeze(client, data); await eligible(client, frozen.id);
  const lease = await leaseFor(client, frozen.id);
  const result = await executeDatabaseDeletion(client, lease, roots(fixture), { afterIntent: async () => {
    await assert.rejects(commitDatabaseDeletion(client, lease), { code: "DATA_DELETE_FILES_PENDING" });
    await retained(client, data); throw new DataDeleteError("DATA_DELETE_TEST_STOP", true);
  } });
  assert.equal(result.state, "RETRY_WAIT"); await retained(client, data);
  assert.equal((await executeDatabaseDeletion(client, lease, roots(fixture))).state, "LEASE_LOST");
  await retained(client, data);
}
async function wrongFile(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await deletionCase(client, fixture); const frozen = await freeze(client, data); await eligible(client, frozen.id);
  const file = uploadPath(fixture, data); const bytes = await readFile(file);
  // 只损坏本阶段登记的文件，验证真实 hash 拒绝；随后原 inode 就地恢复合成字节。
  await writeFile(file, Buffer.alloc(bytes.length, 33));
  const failed = await executeDatabaseDeletion(client, await leaseFor(client, frozen.id), roots(fixture));
  assert.equal(failed.state, "FAILED"); await retained(client, data);
  await writeFile(file, bytes); await control(client, data, frozen.id, "retry");
  assert.equal((await executeDatabaseDeletion(client, await leaseFor(client, frozen.id), roots(fixture))).state, "SUCCEEDED");
  assert.equal(await storageUsedBytes(client, data.workspace.id), 0n);
}
async function cleanupFailure(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await deletionCase(client, fixture); const frozen = await freeze(client, data); await eligible(client, frozen.id);
  const result = await executeDatabaseDeletion(client, await leaseFor(client, frozen.id), roots(fixture), {
    afterUnlink: async () => { throw new DataDeleteError("DATA_DELETE_UNLINK_INTERRUPTED"); },
  });
  assert.equal(result.state, "FAILED"); await retained(client, data);
  const files = await client.dataDeletionFile.findMany({ where: { intentId: frozen.id } });
  assert.ok(files.some(file => file.phase !== "REMOVED"));
  await control(client, data, frozen.id, "retry");
  assert.equal((await executeDatabaseDeletion(client, await leaseFor(client, frozen.id), roots(fixture))).state, "SUCCEEDED");
  assert.equal(await storageUsedBytes(client, data.workspace.id), 0n);
}
async function transactionBoundary(client: PrismaClient, fixture: StorageQuotaFixture, kind: "Note" | "StudyResource", rollback: boolean) {
  let data = await deletionCase(client, fixture, kind, kind === "StudyResource");
  if (kind === "StudyResource") data = { ...data, target: { requesterId: data.owner.id, scope: "WORKSPACE",
    workspaceId: data.workspace.id, resourceType: null, resourceId: null } };
  const frozen = await freeze(client, data); await eligible(client, frozen.id);
  const observer = createPrismaClient(process.env.DATABASE_URL!, { max: 2 });
  const lease = await leaseFor(client, frozen.id); let observed = false;
  try {
    const result = await executeDatabaseDeletion(client, lease, roots(fixture), { afterFileIntent: async () => {
      const cleanup = storageCleanupDescriptor(await client.attachment.findUniqueOrThrow({ where: { id: data.attachment.id }, select: storageCleanupSelect }));
      assert.equal(await completeAttachmentStorageCleanup(cleanup, {}, { boundNote: true }), false);
      await retained(observer, data); await verify(client, frozen.id);
    }, afterSql: async tx => {
      const [active] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      const [reader] = await observer.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      assert.notEqual(active!.pid, reader!.pid);
      assert.equal(await tx.attachment.count({ where: { id: data.attachment.id } }), 0);
      assert.equal(await tx.dataDeletionLedger.count({ where: { intentId: frozen.id } }), 0);
      await retained(observer, data);
      assert.equal(await observer.dataDeletionLedger.count({ where: { intentId: frozen.id } }), 0);
      assert.equal((await observer.dataDeletionIntent.findUniqueOrThrow({ where: { id: frozen.id } })).state, "RUNNING");
      assert.equal(await observer.dataDeletionFile.count({ where: { intentId: frozen.id, phase: { not: "REMOVED" } } }), 0);
      await assert.rejects(fileIdentity(uploadPath(fixture, data)), { code: "ENOENT" });
      observed = true;
      storageDeletionEvidence.push({ event: "delete-sql-uncommitted", intentId: frozen.id, kind, rollback, writerPid: active!.pid, observerPid: reader!.pid,
        occupiedBytes: data.attachment.sizeBytes, filesRemoved: true, sourceVisibleToObserver: true, ledgerRows: 0 });
      if (rollback) throw new DataDeleteError("DATA_DELETE_SQL_ROLLBACK");
    }, beforeCommit: async () => { await retained(observer, data); } });
    assert.ok(observed);
    if (rollback) {
      assert.equal(result.state, "FAILED"); await retained(observer, data); await verify(client, frozen.id);
      await control(client, data, frozen.id, "retry");
      assert.equal((await executeDatabaseDeletion(client, await leaseFor(client, frozen.id), roots(fixture))).state, "SUCCEEDED");
    } else assert.equal(result.state, "SUCCEEDED");
    assert.equal(await storageUsedBytes(observer, data.workspace.id), 0n);
    assert.equal(await observer.attachment.count({ where: { id: data.attachment.id } }), 0);
    const ledger = await observer.dataDeletionLedger.findMany({ where: { intentId: frozen.id } }); assert.equal(ledger.length, 1);
    assert.equal((await executeDatabaseDeletion(client, lease, roots(fixture))).state, "LEASE_LOST");
    assert.deepEqual(await observer.dataDeletionLedger.findMany({ where: { intentId: frozen.id } }), ledger);
  } finally { await observer.$disconnect(); }
}
async function concurrentFreeze(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await deletionCase(client, fixture);
  let release!: () => void; let entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { entered = resolve; });
  const operation = withAttachmentFileOperation(data.attachment.id, async () => { entered(); await waiting; });
  await ready;
  let settled = false; const freezing = freeze(client, data).finally(() => { settled = true; });
  try {
    // 独立连接观察 exclusive freeze 被 shared 文件操作锁阻塞。
    let blocked = false;
    for (let index = 0; index < 100; index++) {
      const [row] = await client.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted`;
      if (row!.n > 0n) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(blocked); assert.equal(settled, false);
  } finally { release(); await operation; }
  const frozen = await freezing; await retained(client, data); await verify(client, frozen.id);
  await assert.rejects(withAttachmentFileOperation(data.attachment.id, async () => {}), { code: "WORKSPACE_STORAGE_QUOTA_BUSY" });
  await control(client, data, frozen.id, "restore");
}
export async function runStorageDeletionMatrix(client: PrismaClient, fixture: StorageQuotaFixture, check: Check) {
  for (const kind of ["Note", "StudyResource"] as const) await check("freeze-restore-" + kind, () => frozenControls(client, fixture, kind));
  await check("freeze-cancel-workspace", () => cancelWorkspace(client, fixture));
  for (const status of ["PENDING", "FAILED"] as const) await check("unsettled-occupied-and-delete-refused-" + status, () => unsettled(client, fixture, status));
  await check("released-failed-does-not-grant-delete-eligibility", () => releasedNotEligible(client, fixture));
  await check("unremoved-file-and-invalidated-lease-retain-usage", () => pendingFiles(client, fixture));
  await check("hash-mismatch-retains-usage-and-real-retry", () => wrongFile(client, fixture));
  await check("unlink-failure-before-removed-retains-usage", () => cleanupFailure(client, fixture));
  for (const kind of ["Note", "StudyResource"] as const) for (const rollback of [false, true]) {
    await check("source-delete-uncommitted-" + kind + (rollback ? "-rollback" : "-commit"), () => transactionBoundary(client, fixture, kind, rollback));
  }
  await check("required-relation-visibility-and-unrelated-mutation", () => storageRequiredRelationVisibility(client, fixture));
  await check("resource-closure-retains-file-and-usage", () => storageResourceClosure(client, fixture));
  await check("same-bucket-other-object-member-and-workspace-preserved", () => storageDeletionScope(client, fixture));
  await check("natural-expired-lease-and-scoped-reclaim", () => storageExpiredLease(client, fixture));
  await check("file-operation-freeze-concurrency", () => concurrentFreeze(client, fixture));
}
