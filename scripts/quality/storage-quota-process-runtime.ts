import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../../packages/db/src/index";
import { isVerifiedStorageRelease } from "../../packages/core/src/index";
import { createStagingAttachmentName, stagingDirectoryName } from "../../packages/storage/src/index";
import { createNoteAttachment, createWorkspaceAttachment, stageWorkspaceAttachment } from "../../apps/web/lib/study/attachments-service";
import { reconcileNewProtocolAttachments } from "../../apps/web/lib/study/attachment-reconciliation-service";
import { createStorageCase, storagePdfBytes, storageScan, storageUsedBytes, withStoragePolicy } from "./storage-quota-runtime-data";
import { runStorageProcess, startStorageProcess, type StorageProcessRequest } from "./storage-quota-process-control";
import type { StorageQuotaFixture } from "./storage-quota-fixture";

type Client = PrismaClient;
export const storageCrashEvidence: object[] = [];
async function rowFor(client: Client, ownerUserId: string) {
  return client.attachment.findFirstOrThrow({ where: { ownerUserId }, orderBy: { createdAt: "desc" } });
}
type Row = Awaited<ReturnType<typeof rowFor>>;
function filePaths(fixture: StorageQuotaFixture, row: Row) {
  return [path.join(fixture.root, "uploads", row.storedName),
    path.join(fixture.root, "uploads", stagingDirectoryName, createStagingAttachmentName(row.storedName))];
}
async function inspectFile(file: string) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat(); assert.ok(stat.isFile()); assert.equal(stat.nlink, 1);
    const bytes = await handle.readFile(); const after = await handle.stat();
    assert.equal(after.size, stat.size); assert.equal(after.ino, stat.ino); assert.equal(after.mtimeMs, stat.mtimeMs);
    return { dev: stat.dev, ino: stat.ino, size: stat.size, hash: createHash("sha256").update(bytes).digest("hex"), nlink: stat.nlink };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  finally { await handle?.close(); }
}
export async function snapshot(client: Client, fixture: StorageQuotaFixture, attachmentId: string) {
  const row = await client.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
  const files = await Promise.all(filePaths(fixture, row).map(inspectFile));
  return { status: row.status, stagingName: row.stagingName, hash: row.hash, sizeBytes: row.sizeBytes,
    releaseAt: row.storageReleasedAt?.toISOString() ?? null, releaseProof: row.storageReleaseProof,
    verifiedRelease: isVerifiedStorageRelease(row), usedBytes: String(await storageUsedBytes(client, row.storageWorkspaceId!)),
    physicalBytes: files.reduce((sum, file) => sum + (file?.size ?? 0), 0), files };
}
async function killAt(client: Client, fixture: StorageQuotaFixture, request: StorageProcessRequest) {
  const child = await startStorageProcess(fixture, request);
  try {
    const barrier = await child.next(); assert.equal(barrier.state, "barrier"); assert.equal(barrier.point, request.point);
    const [backend] = await client.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    assert.notEqual(backend!.pid, child.backendPid);
    const row = await rowFor(client, request.ownerId);
    const before = await snapshot(client, fixture, row.id);
    const exit = await child.stop(); assert.deepEqual(exit, { code: null, signal: "SIGKILL" });
    assert.deepEqual(await snapshot(client, fixture, row.id), before, "committed state survives child death");
    return { row, before, exit, pid: child.pid, childBackendPid: child.backendPid, observerBackendPid: backend!.pid, barrier: request.point };
  } finally { await child.close(); }
}
export function assertFiles(state: Awaited<ReturnType<typeof snapshot>>, position: number | null) {
  for (const [index, file] of state.files.entries()) {
    if (index !== position) assert.equal(file, null);
    else { assert.ok(file); assert.equal(file.size, storagePdfBytes.length); assert.equal(file.hash, storageScan().sha256Hex); }
  }
}
async function assertFull(client: Client, data: Awaited<ReturnType<typeof createStorageCase>>) {
  assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(storagePdfBytes.length));
  await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: String(storagePdfBytes.length) }, async () => {
    await assert.rejects(createNoteAttachment({ noteId: data.note.id, idempotencyKey: randomUUID(), scan: storageScan() }, data.owner.id),
      { code: "WORKSPACE_STORAGE_QUOTA_LIMIT" });
  });
}
export async function storageUploadKill(client: Client, fixture: StorageQuotaFixture, point: "intent" | "staging" | "renamed") {
  const data = await createStorageCase(client, fixture, "kill-" + point); const key = randomUUID();
  const request: StorageProcessRequest = { kind: "upload", ownerId: data.owner.id, noteId: data.note.id, key };
  const crash = await killAt(client, fixture, { ...request, point });
  assert.equal(crash.before.status, "PENDING"); assert.equal(crash.before.releaseProof, null); assert.equal(crash.before.releaseAt, null);
  assertFiles(crash.before, point === "intent" ? null : point === "staging" ? 1 : 0);
  await assertFull(client, data);
  await assert.rejects(createNoteAttachment({ noteId: data.note.id, idempotencyKey: key, scan: storageScan() }, data.owner.id), { code: "NOTE_ATTACHMENT_UPLOAD_IN_PROGRESS" });
  const reconciled = await runStorageProcess(fixture, { kind: "reconcile", ownerId: data.owner.id, attachmentId: crash.row.id }) as { counts: Record<string, number> };
  const count = point === "intent" ? "failedMissingFileCount" : point === "staging" ? "finalizedFromStagingCount" : "readyFromFinalCount";
  assert.equal(reconciled.counts[count], 1);
  const recovered = await snapshot(client, fixture, crash.row.id);
  if (point === "intent") {
    assert.equal(recovered.status, "FAILED"); assert.equal(recovered.verifiedRelease, true); assert.equal(recovered.usedBytes, "0"); assertFiles(recovered, null);
  } else {
    assert.equal(recovered.status, "READY"); assert.equal(recovered.releaseAt, null); assertFiles(recovered, 0);
    assert.equal(recovered.files[0]!.ino, crash.before.files[point === "staging" ? 1 : 0]!.ino);
  }
  const first = await runStorageProcess(fixture, request) as { id: string };
  const replay = await runStorageProcess(fixture, request) as { id: string }; assert.equal(replay.id, first.id);
  assert.equal(first.id === crash.row.id, point !== "intent");
  assert.equal(await client.attachment.count({ where: { ownerUserId: data.owner.id } }), point === "intent" ? 2 : 1);
  await assertFull(client, data);
  storageCrashEvidence.push({ case: "upload-" + point, ...crash, row: undefined, recovered, replayIdStable: true,
    afterRetry: await snapshot(client, fixture, first.id), recovery: count });
}
export async function storageCleanupKill(client: Client, fixture: StorageQuotaFixture, point: "removed" | "released", final: boolean) {
  const data = await createStorageCase(client, fixture, "kill-cleanup-" + point + (final ? "-final" : "-staging"));
  const created = await (final ? createWorkspaceAttachment : stageWorkspaceAttachment)({ scan: storageScan() }, data.owner.id);
  const initial = await snapshot(client, fixture, created.id); assertFiles(initial, final ? 0 : 1);
  const request: StorageProcessRequest = { kind: "cleanup", ownerId: data.owner.id, attachmentId: created.id };
  const crash = await killAt(client, fixture, { ...request, point });
  assert.equal(crash.before.status, "FAILED"); assertFiles(crash.before, null);
  assert.equal(crash.before.verifiedRelease, point === "released");
  assert.equal(crash.before.usedBytes, point === "released" ? "0" : String(storagePdfBytes.length));
  if (point === "removed") { assert.equal(crash.before.releaseAt, null); assert.equal(crash.before.releaseProof, null); await assertFull(client, data); }
  assert.equal(await runStorageProcess(fixture, request), true);
  const recovered = await snapshot(client, fixture, created.id);
  assert.equal(recovered.verifiedRelease, true); assert.equal(recovered.usedBytes, "0"); assertFiles(recovered, null);
  if (point === "released") assert.deepEqual(recovered, crash.before);
  assert.equal(await runStorageProcess(fixture, request), true);
  assert.deepEqual(await snapshot(client, fixture, created.id), recovered, "no second release or timestamp mutation");
  if (point === "released") await rejectReappearance(client, fixture, data, crash.row, request, recovered);
  const successor = await createNoteAttachment({ noteId: data.note.id, idempotencyKey: randomUUID(), scan: storageScan() }, data.owner.id);
  await assertFull(client, data);
  storageCrashEvidence.push({ case: "cleanup-" + point + (final ? "-final" : "-staging"), ...crash, row: undefined, initial, recovered,
    successor: await snapshot(client, fixture, successor.id), recovery: "fresh-process-cleanup-retry", repeatReleaseStable: true });
}
async function rejectReappearance(client: Client, fixture: StorageQuotaFixture, data: Awaited<ReturnType<typeof createStorageCase>>, row: Row,
  request: StorageProcessRequest, released: Awaited<ReturnType<typeof snapshot>>) {
  for (const file of filePaths(fixture, row)) {
    await writeFile(file, storagePdfBytes, { flag: "wx", mode: 0o600 }); const identity = await inspectFile(file);
    try {
      assert.equal(await runStorageProcess(fixture, request), false); assert.deepEqual(await inspectFile(file), identity);
      await assert.rejects(createNoteAttachment({ noteId: data.note.id, idempotencyKey: randomUUID(), scan: storageScan() }, data.owner.id),
        { code: "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN" });
      const current = await snapshot(client, fixture, row.id); assert.equal(current.releaseAt, released.releaseAt); assert.equal(current.releaseProof, released.releaseProof);
    } finally { assert.deepEqual(await inspectFile(file), identity); await unlink(file); }
  }
}
export async function storageAmbiguousKill(client: Client, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "kill-dual");
  const crash = await killAt(client, fixture, { kind: "upload", ownerId: data.owner.id, noteId: data.note.id, key: randomUUID(), point: "staging" });
  const [final] = filePaths(fixture, crash.row);
  await writeFile(final!, storagePdfBytes, { flag: "wx", mode: 0o600 }); const identity = await inspectFile(final!);
  try {
    const before = await snapshot(client, fixture, crash.row.id);
    const result = await runStorageProcess(fixture, { kind: "reconcile", ownerId: data.owner.id, attachmentId: crash.row.id }) as { counts: Record<string, number> };
    assert.equal(result.counts.blockedDualFileCount, 1); assert.deepEqual(await snapshot(client, fixture, crash.row.id), before);
    await assertFull(client, data);
    await assert.rejects(createNoteAttachment({ noteId: data.note.id, idempotencyKey: randomUUID(), scan: storageScan() }, data.owner.id), { code: "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN" });
    storageCrashEvidence.push({ case: "dual-file-after-kill", ...crash, row: undefined, recovered: before, recovery: "blocked-retains-reservation-and-both-files" });
  } finally { assert.deepEqual(await inspectFile(final!), identity); await unlink(final!); }
  await runStorageProcess(fixture, { kind: "reconcile", ownerId: data.owner.id, attachmentId: crash.row.id });
}
export async function storageCleanupPathDrift(client: Client, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "kill-drift");
  const created = await stageWorkspaceAttachment({ scan: storageScan() }, data.owner.id); const row = await rowFor(client, data.owner.id);
  const request: StorageProcessRequest = { kind: "cleanup", ownerId: data.owner.id, attachmentId: created.id };
  const child = await startStorageProcess(fixture, { ...request, point: "before-unlink" });
  const file = filePaths(fixture, row)[1]!; const held = path.join(fixture.root, "exports", "storage-kill-" + randomUUID());
  let moved = false; let injected: Awaited<ReturnType<typeof inspectFile>> = null;
  try {
    const barrier = await child.next(); assert.equal(barrier.state, "barrier"); assert.equal(barrier.point, "before-unlink");
    const original = await inspectFile(file); assert.ok(original);
    await rename(file, held); moved = true;
    await writeFile(file, storagePdfBytes, { flag: "wx", mode: 0o600 }); injected = await inspectFile(file);
    assert.notEqual(injected!.ino, original.ino);
    child.continue(); assert.equal(await child.finish(), false);
    assert.deepEqual(await inspectFile(file), injected); await assertFull(client, data);
    // 新进程面对不同内容/大小的替换文件也不能删除或结算。
    await writeFile(file, Buffer.from("%PDF-PARTIAL")); injected = await inspectFile(file);
    assert.equal(await runStorageProcess(fixture, request), false); assert.deepEqual(await inspectFile(file), injected);
    await assertFull(client, data);
    storageCrashEvidence.push({ case: "cleanup-inode-and-partial-file-refusal", original, replacement: injected,
      recovered: await snapshot(client, fixture, created.id), recovery: "blocked-retains-reservation-and-replacement" });
  } finally {
    await child.close();
    if (moved) { if (injected) { assert.deepEqual(await inspectFile(file), injected); await unlink(file); } await rename(held, file); }
  }
  assert.equal(await runStorageProcess(fixture, request), true);
}
export async function storageReconciliationSelection(client: Client) {
  const before = await client.attachment.findMany({ orderBy: { id: "asc" } });
  const result = await reconcileNewProtocolAttachments({ attachmentIds: [], minIntentAgeMs: 0 });
  assert.equal(result.counts.scannedCount, 0);
  assert.deepEqual(await client.attachment.findMany({ orderBy: { id: "asc" } }), before);
}
