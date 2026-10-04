import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { createPrismaClient, type Prisma, type PrismaClient } from "../../packages/db/src/index";
import { createStorageAttachmentIntent } from "../../apps/web/lib/study/attachment-storage-service";
import { createNoteAttachment, getAttachmentDownload } from "../../apps/web/lib/study/attachments-service";
import { createNote, getNoteById } from "../../apps/web/lib/study/notes-service";
import { createStudyTask, dropStudyTask } from "../../apps/web/lib/study/task-command-service";
import { controlDurableDataExport } from "../../apps/web/lib/system/data-export-runtime-service";
import { stageStudyResourceUploadBatch } from "../../apps/web/lib/study/study-resource-service";
import { lockActorWorkspaceScope, workspaceLockNamespace } from "../../apps/web/lib/study/exam-workspace-service";
import { type StorageQuotaFixture, storageQuotaFixtureEnvironment, verifyStorageQuotaFixtureLedger } from "./storage-quota-fixture";
import { createStorageCase, retryStorageRequest, seedStorageFile, storageErrorCode, storagePdfBytes, storageScan,
  storageUsedBytes, uploadStorageNote, withStoragePolicy, type StorageCase } from "./storage-quota-runtime-data";

const serializable = { isolationLevel: "Serializable" as const, timeout: 15_000 };
function signal() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("STORAGE_BARRIER_TIMEOUT")), 8_000);
  })]); } finally { clearTimeout(timer); }
}
function intent(data: StorageCase, bytes = 1) {
  const storedName = randomUUID().replaceAll("-", "") + ".md";
  return { actorId: data.owner.id, workspaceId: data.workspace.id, noteId: data.note.id, stagingName: storedName + ".staging",
    draft: { originalName: "synthetic.md", storedName, uri: "upload://attachment/" + storedName,
      hash: "a".repeat(64), sizeBytes: bytes, mimeType: "text/markdown" } };
}
async function connections<T>(fixture: StorageQuotaFixture, run: (clients: PrismaClient[]) => Promise<T>) {
  const clients = Array.from({ length: 2 }, () => createPrismaClient(storageQuotaFixtureEnvironment(fixture).DATABASE_URL, { max: 1 }));
  try {
    for (const client of clients) await verifyStorageQuotaFixtureLedger(client, fixture);
    const pids = await Promise.all(clients.map(client => client.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`));
    assert.equal(new Set(pids.map(rows => rows[0]!.pid)).size, 2, "STORAGE_CONNECTIONS_NOT_INDEPENDENT");
    return await run(clients);
  } finally { await Promise.all(clients.map(client => client.$disconnect())); }
}

/** 两个后端都进入事务后再竞争同一工作区的最后 1 byte；赢家提交后再重试输家。 */
export async function storageLastByteRace(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "last-byte-race");
  await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "1" }, () => connections(fixture, async clients => {
    const entered = clients.map(() => signal()); const start = signal();
    const attempts = clients.map((connection, index) => connection.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_backend_pid()`;
      entered[index]!.release(); await bounded(start.promise);
      return createStorageAttachmentIntent(tx, intent(data));
    }, serializable));
    const settled = Promise.allSettled(attempts);
    try { await bounded(Promise.all(entered.map(item => item.promise))); } finally { start.release(); }
    const results = await settled;
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const loser = results.findIndex(result => result.status === "rejected");
    assert.ok(loser >= 0);
    const failure = results[loser] as PromiseRejectedResult;
    assert.ok(["WORKSPACE_STORAGE_QUOTA_BUSY", "WORKSPACE_STORAGE_QUOTA_LIMIT", "40001", "P2034"].includes(storageErrorCode(failure.reason)));
    await assert.rejects(clients[loser]!.$transaction(tx => createStorageAttachmentIntent(tx, intent(data)), serializable),
      { code: "WORKSPACE_STORAGE_QUOTA_LIMIT" });
    assert.equal(await storageUsedBytes(client, data.workspace.id), 1n);
    assert.equal(await client.attachment.count({ where: { ownerUserId: data.owner.id } }), 1);
    assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "ATTACHMENT_INTENT_CREATED" } }), 1);
  }));
}

/** 旧快照等待另一连接提交后即使取得 advisory lock，也必须被 PostgreSQL 的 SSI 拒绝。 */
export async function storageStaleSnapshot(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "stale-snapshot");
  await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "1" }, () => connections(fixture, async ([old, fresh]) => {
    const read = signal(); const committed = signal();
    const oldAttempt = old!.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Attachment" WHERE "storageWorkspaceId"=${data.workspace.id}`;
      read.release(); await bounded(committed.promise);
      return createStorageAttachmentIntent(tx, intent(data));
    }, serializable);
    const outcome = oldAttempt.then(() => "committed", storageErrorCode);
    try {
      await bounded(read.promise);
      await fresh!.$transaction(tx => createStorageAttachmentIntent(tx, intent(data)), serializable);
    } finally { committed.release(); }
    assert.ok(["40001", "P2034"].includes(await outcome), "STORAGE_STALE_SNAPSHOT_NOT_ABORTED");
    assert.equal(await storageUsedBytes(client, data.workspace.id), 1n);
    assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "ATTACHMENT_INTENT_CREATED" } }), 1);
  }));
}

export async function storageAtomicPending(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "atomic-pending"); const key = randomUUID();
  await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: String(storagePdfBytes.length) }, async () => {
    const beforeWrite = signal(); const proceed = signal();
    const upload = createNoteAttachment({ noteId: data.note.id, idempotencyKey: key, scan: storageScan() }, data.owner.id,
      { beforeStagingWrite: async () => { beforeWrite.release(); await bounded(proceed.promise); } });
    // 立即挂上拒绝处理，避免屏障失败时产生未处理 Promise。
    const outcome = upload.then(value => ({ value }), error => ({ error }));
    try {
      await bounded(beforeWrite.promise);
      const row = await client.attachment.findFirstOrThrow({ where: { ownerUserId: data.owner.id } });
      assert.equal(row.status, "PENDING"); assert.equal(row.storageWorkspaceId, data.workspace.id);
      assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(storagePdfBytes.length));
      await assert.rejects(access(path.join(fixture.root, "uploads", row.storedName)), { code: "ENOENT" });
      await assert.rejects(access(path.join(fixture.root, "uploads", ".staging", row.stagingName!)), { code: "ENOENT" });
      const claim = await client.auditEvent.findFirstOrThrow({ where: { actorId: data.owner.id, action: "NOTE_ATTACHMENT_UPLOAD_COMMAND" } });
      assert.equal((claim.metadata as Prisma.JsonObject).storageIntentId, row.id);
      await assert.rejects(retryStorageRequest(() => uploadStorageNote(data, key)), { code: "NOTE_ATTACHMENT_UPLOAD_IN_PROGRESS" });
      await assert.rejects(retryStorageRequest(() => uploadStorageNote(data)), { code: "WORKSPACE_STORAGE_QUOTA_LIMIT" });
      assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "NOTE_ATTACHMENT_UPLOAD_COMMAND" } }), 1);
    } finally { proceed.release(); }
    const result = await outcome; if ("error" in result) throw result.error;
    const replays = await Promise.all(Array.from({ length: 4 }, () => retryStorageRequest(() => uploadStorageNote(data, key))));
    assert.ok(replays.every(row => row.id === result.value.id));
    assert.equal(await client.attachment.count({ where: { ownerUserId: data.owner.id } }), 1);
    assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "ATTACHMENT_INTENT_CREATED" } }), 1);
  });
}

export async function storageIntentRollback(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "intent-rollback"); const input = intent(data);
  await assert.rejects(client.$transaction(async tx => {
    await createStorageAttachmentIntent(tx, input);
    throw new Error("SYNTHETIC_ABORT_AFTER_INTENT");
  }, serializable), /SYNTHETIC_ABORT_AFTER_INTENT/);
  assert.equal(await storageUsedBytes(client, data.workspace.id), 0n);
  assert.equal(await client.attachment.count({ where: { ownerUserId: data.owner.id } }), 0);
  assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id } }), 0);
  await client.$transaction(tx => createStorageAttachmentIntent(tx, input), serializable);
  assert.equal(await storageUsedBytes(client, data.workspace.id), 1n);
}

export async function storageInitialSameKeyRace(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "initial-same-key"); const key = randomUUID();
  const held = signal(); const releaseLock = signal(); const beforeWrite = signal(); const releaseWrite = signal();
  const blocker = client.$transaction(async tx => {
    await lockActorWorkspaceScope(tx, data.owner.id); held.release(); await bounded(releaseLock.promise);
  }, { timeout: 15_000 });
  const blockerResult = blocker.then(() => null, error => error);
  await bounded(held.promise);
  const outcomes = Array.from({ length: 2 }, () => createNoteAttachment({ noteId: data.note.id, idempotencyKey: key, scan: storageScan() }, data.owner.id,
    { beforeStagingWrite: async () => { beforeWrite.release(); await bounded(releaseWrite.promise); } })
    .then(value => ({ value }), error => ({ error })));
  try {
    // 两个请求实际同时等在同一 workspace 锁上，再放行，不能以 Promise.all 本身证明竞争。
    await bounded((async () => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const [row] = await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(DISTINCT pid)::bigint AS count
          FROM pg_locks WHERE locktype='advisory' AND classid=${workspaceLockNamespace}::oid AND NOT granted`;
        if (row!.count >= 2n) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("STORAGE_INITIAL_REQUESTS_DID_NOT_OVERLAP");
    })());
    releaseLock.release(); assert.equal(await blockerResult, null);
    await bounded(beforeWrite.promise);
    const loser = await bounded(Promise.race(outcomes));
    assert.ok("error" in loser);
    assert.ok(["WORKSPACE_STORAGE_QUOTA_BUSY", "NOTE_ATTACHMENT_UPLOAD_IN_PROGRESS"].includes(storageErrorCode(loser.error)));
    assert.equal(await client.attachment.count({ where: { ownerUserId: data.owner.id } }), 1);
    assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "NOTE_ATTACHMENT_UPLOAD_COMMAND" } }), 1);
  } finally { releaseLock.release(); releaseWrite.release(); await blockerResult; await Promise.all(outcomes); }
  const results = await Promise.all(outcomes); const winner = results.find(result => "value" in result);
  assert.ok(winner && "value" in winner);
  assert.equal((await retryStorageRequest(() => uploadStorageNote(data, key))).id, winner.value.id);
  assert.equal(await storageUsedBytes(client, data.workspace.id), BigInt(storagePdfBytes.length));
  assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "ATTACHMENT_INTENT_CREATED" } }), 1);
}

export async function storageCorruptAdmission(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "corrupt-admission");
  const variants = [
    { storageWorkspaceId: null, noteId: null },
    { storageWorkspaceId: null, ownerUserId: data.member.id },
    { sizeBytes: 0 }, { sizeBytes: -1 }, { hash: "broken" }, { uri: "upload://attachment/wrong.pdf" },
    { protocolVersion: -1 },
    { status: "FAILED" as const, stagingName: null, storageReleasedAt: new Date(), storageReleaseProof: "sha256:" + "0".repeat(64) },
  ];
  for (const patch of variants) {
    await assert.rejects(client.$transaction(async tx => {
      const input = intent(data);
      await tx.attachment.create({ data: { ...input.draft, ownerUserId: data.owner.id, noteId: data.note.id,
        storageWorkspaceId: data.workspace.id, status: "PENDING", protocolVersion: 1, stagingName: input.stagingName, ...patch } });
      await createStorageAttachmentIntent(tx, intent(data));
    }, serializable), { code: "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN" });
  }
  assert.equal(await client.attachment.count({ where: { ownerUserId: { in: [data.owner.id, data.member.id] } } }), 0);
  for (const status of ["PENDING", "READY", "FAILED"] as const) {
    await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "1" }, async () => {
      await assert.rejects(client.$transaction(async tx => {
        const input = intent(data);
        await tx.attachment.create({ data: { ...input.draft, ownerUserId: data.owner.id, noteId: data.note.id,
          storageWorkspaceId: null, protocolVersion: 0, status } });
        await createStorageAttachmentIntent(tx, intent(data));
      }, serializable), { code: "WORKSPACE_STORAGE_QUOTA_LIMIT" });
    });
  }
}

export async function storageLegacyResourceBuckets(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "legacy-resource");
  for (const dualReference of [false, true]) {
    await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "1" }, async () => {
      await assert.rejects(client.$transaction(async tx => {
        const input = intent(data);
        const row = await tx.attachment.create({ data: { ...input.draft, ownerUserId: data.owner.id,
          noteId: dualReference ? data.note.id : null, storageWorkspaceId: null, protocolVersion: 0, status: "READY" } });
        await tx.studyResource.create({ data: { ownerUserId: data.owner.id, workspaceId: data.workspace.id,
          title: "旧资料归属合成样例", stableKey: randomUUID(), sourceType: "FILE", attachmentId: row.id } });
        await createStorageAttachmentIntent(tx, intent(data));
      }, serializable), { code: dualReference ? "WORKSPACE_STORAGE_QUOTA_USAGE_UNKNOWN" : "WORKSPACE_STORAGE_QUOTA_LIMIT" });
    });
  }
  assert.equal(await client.attachment.count({ where: { ownerUserId: data.owner.id } }), 0);
}

export async function storageNonUploadPaths(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "non-upload");
  const file = await seedStorageFile(client, fixture, data);
  for (const config of ["0", "bad", "-1", "01", "9007199254740992"]) {
    const job = await client.dataJob.create({ data: { kind: "EXPORT", scope: "ACCOUNT", status: "QUEUED",
      requestedByUserId: data.owner.id, queueVersion: 1, idempotencyKey: randomUUID(), requestFingerprint: "synthetic-storage-control",
      expiresAt: new Date(Date.now() + 60_000) } });
    await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: config }, async () => {
      await assert.rejects(uploadStorageNote(data), { code: config === "0" ? "WORKSPACE_STORAGE_QUOTA_LIMIT" : "WORKSPACE_STORAGE_QUOTA_CONFIG_INVALID" });
      const note = await createNote({ subjectId: data.subject.id, title: "合成文本学习", content: "SYNTHETIC_TEXT", idempotencyKey: randomUUID() }, data.owner.id);
      assert.equal((await getNoteById(note.id, data.owner.id))?.id, note.id);
      const task = await createStudyTask({ subjectId: data.subject.id, title: "合成学习任务", type: "STUDY", priority: "medium",
        estimatedMinutes: 5, idempotencyKey: randomUUID() }, data.owner.id);
      assert.equal((await dropStudyTask(task.id, data.owner.id)).status, "skipped");
      assert.equal((await controlDurableDataExport(data.owner, job.id, job.updatedAt.getTime(), "CANCEL")).status, "CANCELLED");
      const download = await getAttachmentDownload(file.id, "attachment", data.owner.id);
      assert.deepEqual(Buffer.from(download.bytes), storagePdfBytes);
      assert.equal(download.headers["Cache-Control"], "private, no-store");
      await assert.rejects(getAttachmentDownload(file.id, "attachment", data.outsider.id), { status: 404 });
    });
  }
}

export async function storageBatchRejectionReplay(client: PrismaClient, fixture: StorageQuotaFixture) {
  const data = await createStorageCase(client, fixture, "batch-replay"); const key = randomUUID();
  const rejected = await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: "0" }, () => stageStudyResourceUploadBatch(data.owner.id, [storageScan()], key));
  assert.equal(rejected[0]!.error, "WORKSPACE_STORAGE_QUOTA_LIMIT");
  assert.equal(await client.attachment.count({ where: { ownerUserId: data.owner.id } }), 0);
  assert.deepEqual(await stageStudyResourceUploadBatch(data.owner.id, [storageScan()], key), rejected);
  const freshKey = randomUUID(); const fresh = await stageStudyResourceUploadBatch(data.owner.id, [storageScan()], freshKey);
  assert.ok(fresh[0]!.staging);
  assert.deepEqual(await stageStudyResourceUploadBatch(data.owner.id, [storageScan()], freshKey), fresh);
  assert.equal(await client.attachment.count({ where: { ownerUserId: data.owner.id } }), 1);
}
