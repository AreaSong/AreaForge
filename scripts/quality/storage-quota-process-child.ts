import assert from "node:assert/strict";
import { loadStorageQuotaFixture, assertStorageQuotaFixtureContainer, storageQuotaFixtureEnvironment, verifyStorageQuotaFixtureLedger } from "./storage-quota-fixture";
import { storageQuotaSourceFingerprint } from "./storage-quota-source";
import type { StorageProcessRequest } from "./storage-quota-process-control";

async function main() {
  assert.ok(process.send && process.connected, "STORAGE_IPC_REQUIRED");
  const fixture = loadStorageQuotaFixture(process.argv[2] ?? ""); assertStorageQuotaFixtureContainer(fixture);
  const nonce = process.argv[3]; assert.match(nonce ?? "", /^[a-f0-9]{64}$/);
  const env = storageQuotaFixtureEnvironment(fixture);
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
  const { prisma } = await import("../../packages/db/src/index");
  try {
    await verifyStorageQuotaFixtureLedger(prisma, fixture);
    const [backend] = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    const received = new Promise<StorageProcessRequest>(resolve => process.once("message", value => resolve(value as StorageProcessRequest)));
    const send = (value: object) => process.send!({ ...value, nonce, pid: process.pid, ppid: process.ppid,
      uid: process.getuid!(), fixtureId: fixture.scopeId, backendPid: backend!.pid, sourceFingerprint: storageQuotaSourceFingerprint() });
    send({ state: "ready" });
    const request = await received;
    assert.ok(["upload", "cleanup", "reconcile", "release"].includes(request.kind));
    assert.match(request.ownerId, /^[A-Za-z0-9_-]+$/);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: request.ownerId }, select: { email: true } });
    assert.match(owner.email, /^storage-kill-[a-z0-9-]+-owner@example\.test$/);
    if (request.attachmentId) assert.ok(await prisma.attachment.findFirst({ where: { id: request.attachmentId, ownerUserId: request.ownerId } }));
    const barrier = async (point: string, observation?: unknown, force = false) => {
      if (!force && request.point !== point) return;
      send({ state: "barrier", point, observation });
      await new Promise<void>(resolve => process.once("message", value => {
        assert.deepEqual(value, { action: "continue", nonce }); resolve();
      }));
    };
    const api = await import("../../apps/web/lib/study/attachments-service");
    const { storageScan } = await import("./storage-quota-runtime-data");
    let result: unknown;
    if (request.kind === "release") {
      result = await (await import("./storage-quota-release-child")).runStorageReleaseProcess(request, barrier);
    } else if (request.kind === "upload") {
      assert.ok(request.noteId && request.key);
      result = await api.createNoteAttachment({ noteId: request.noteId, idempotencyKey: request.key, scan: storageScan() }, request.ownerId, {
        beforeStagingWrite: () => barrier("intent"), afterStagingWrite: () => barrier("staging"), afterAtomicRename: () => barrier("renamed"),
      });
    } else if (request.kind === "cleanup") {
      assert.ok(request.attachmentId);
      const cleanup = await api.markUnboundAttachmentDiscarded(request.ownerId, request.attachmentId); assert.ok(cleanup);
      result = await api.cleanupDiscardedAttachmentFiles(cleanup, { beforeUnlink: () => barrier("before-unlink"),
        beforeReleaseCommit: () => barrier("removed"), afterReleaseCommit: () => barrier("released") });
    } else {
      assert.ok(request.attachmentId);
      const { reconcileNewProtocolAttachments } = await import("../../apps/web/lib/study/attachment-reconciliation-service");
      result = await reconcileNewProtocolAttachments({ attachmentIds: [request.attachmentId], minIntentAgeMs: 0 });
    }
    send({ state: "done", result });
  } catch (error) {
    const code = (error as { code?: string }).code;
    process.send?.({ state: "failed", code: /^[A-Z0-9_]{1,80}$/.test(code ?? "") ? code : "STORAGE_PROCESS_FAILED" });
    process.exitCode = 1;
  } finally { await prisma.$disconnect(); process.disconnect?.(); }
}
main().catch(error => {
  const code = (error as { code?: string }).code;
  if (process.connected) {
    process.send?.({ state: "failed", code: /^[A-Z0-9_]{1,80}$/.test(code ?? "") ? code : "STORAGE_PROCESS_FAILED" });
    process.disconnect?.();
  }
  process.exitCode = 1;
});
