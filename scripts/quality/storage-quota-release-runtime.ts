import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../packages/db/src/index";
import { createWorkspaceAttachment, stageWorkspaceAttachment, createNoteAttachment } from "../../apps/web/lib/study/attachments-service";
import { createStorageCase, seedStorageFile, storagePdfBytes, storageScan, withStoragePolicy } from "./storage-quota-runtime-data";
import { snapshot, assertFiles } from "./storage-quota-process-runtime";
import { startStorageProcess, type StorageProcessRequest } from "./storage-quota-process-control";
import type { ReleaseObservation, ReleaseReceipt } from "./storage-quota-release-child";
import type { StorageQuotaFixture } from "./storage-quota-fixture";

export const storageReleaseEvidence: object[] = [];
const bytes = storagePdfBytes.length;
type Child = Awaited<ReturnType<typeof startStorageProcess>>;
async function prepared(fixture: StorageQuotaFixture, request: StorageProcessRequest) {
  const child = await startStorageProcess(fixture, request);
  try {
    const message = await child.next(); assert.equal(message.state, "barrier"); assert.equal(message.point, "prepared");
    return child;
  } catch (error) { await child.close(); throw error; }
}
async function retry(fixture: StorageQuotaFixture, request: StorageProcessRequest) {
  const child = await prepared(fixture, { ...request, point: undefined });
  try { child.continue(); return await child.finish() as ReleaseReceipt; } finally { await child.close(); }
}
async function releaseCase(client: PrismaClient, fixture: StorageQuotaFixture, label: string, final: boolean) {
  const data = await createStorageCase(client, fixture, "kill-release-" + label);
  const other = await seedStorageFile(client, fixture, data, { actor: data.member, noteId: data.memberNote.id });
  const otherRow = await client.attachment.findUniqueOrThrow({ where: { id: other.id } });
  const otherFiles = (await snapshot(client, fixture, other.id)).files;
  const created = await (final ? createWorkspaceAttachment : stageWorkspaceAttachment)({ scan: storageScan() }, data.owner.id);
  const initial = await snapshot(client, fixture, created.id); assertFiles(initial, final ? 0 : 1);
  assert.equal(initial.usedBytes, String(bytes * 2));
  const request: StorageProcessRequest = { kind: "release", ownerId: data.owner.id, attachmentId: created.id };
  const protectOther = async () => {
    assert.deepEqual(await client.attachment.findUniqueOrThrow({ where: { id: other.id } }), otherRow);
    assert.deepEqual((await snapshot(client, fixture, other.id)).files, otherFiles);
  };
  return { data, created, initial, request, protectOther };
}
async function liveTransaction(client: PrismaClient, state: ReleaseObservation) {
  const [observed] = await client.$queryRaw<Array<{ observerPid: number; active: boolean; exclusiveLock: boolean }>>`
    SELECT pg_backend_pid() AS "observerPid",
      EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=${state.backendPid} AND backend_xid::text=${state.transactionId}
        AND state='idle in transaction') AS active,
      EXISTS(SELECT 1 FROM pg_locks WHERE pid=${state.backendPid} AND locktype='advisory' AND mode='ExclusiveLock' AND granted) AS "exclusiveLock"`;
  assert.notEqual(observed!.observerPid, state.backendPid); assert.equal(observed!.active, true); assert.equal(observed!.exclusiveLock, true);
  return observed!;
}
async function atBarrier(client: PrismaClient, child: Child, point: "cas-precommit" | "verified-release") {
  const message = await child.next(); assert.equal(message.state, "barrier"); assert.equal(message.point, point);
  const state = message.observation as ReleaseObservation;
  assert.ok(state.releaseAt); assert.ok(state.releaseProof); assert.equal(state.stagingName, null);
  assert.equal(state.cas, point === "cas-precommit" ? 1 : 0); assert.equal(state.verified, point === "verified-release" ? 1 : 0);
  assert.equal(state.committed, 0); assert.equal(state.usedBytes, String(bytes));
  const observer = await liveTransaction(client, state);
  return { state, observer, pid: child.pid };
}
async function denyPrematureUpload(data: Awaited<ReturnType<typeof createStorageCase>>) {
  await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: String(bytes * 2) }, async () => {
    await assert.rejects(createNoteAttachment({ noteId: data.note.id, idempotencyKey: randomUUID(), scan: storageScan() }, data.owner.id),
      { code: "WORKSPACE_STORAGE_QUOTA_LIMIT" });
  });
}
async function outsideBeforeCommit(client: PrismaClient, fixture: StorageQuotaFixture, data: Awaited<ReturnType<typeof releaseCase>>) {
  const outside = await snapshot(client, fixture, data.created.id); assertFiles(outside, null);
  assert.equal(outside.releaseAt, null); assert.equal(outside.releaseProof, null); assert.equal(outside.usedBytes, String(bytes * 2));
  await denyPrematureUpload(data.data); return outside;
}
async function killAndRollback(client: PrismaClient, child: Child, state: ReleaseObservation, attachmentId: string) {
  const exit = await child.stop(); assert.deepEqual(exit, { code: null, signal: "SIGKILL" });
  const deadline = Date.now() + 5000; let rolledBack = false;
  while (Date.now() < deadline) {
    const [row] = await client.$queryRaw<Array<{ done: boolean }>>`SELECT
      NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=${state.backendPid} AND backend_xid::text=${state.transactionId})
      AND NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=${state.backendPid} AND locktype='advisory' AND granted) AS done`;
    if (row?.done) { rolledBack = true; break; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(rolledBack, true, "STORAGE_ROLLBACK_TIMEOUT");
  // 独立连接真实取得行锁，不能仅凭 SIGKILL 或一次旧快照宣称回滚完成。
  await client.$transaction(tx => tx.$queryRaw`SELECT id FROM "Attachment" WHERE id=${attachmentId} FOR UPDATE NOWAIT`);
  return { exit, transactionEnded: true, advisoryLocksGone: true, rowLockReacquired: true };
}
function receipt(value: ReleaseReceipt, expected: { unlinks: number; cas: number; verified: number; result?: boolean }) {
  assert.equal(value.result, expected.result ?? true); assert.equal(value.unlinkAttempts, expected.unlinks); assert.equal(value.unlinks, expected.unlinks);
  assert.equal(value.cas, expected.cas); assert.equal(value.verified, expected.verified);
  assert.equal(value.cleanupProofs, expected.cas); assert.equal(value.committed, value.result ? 1 : 0);
}
async function finalState(client: PrismaClient, fixture: StorageQuotaFixture, data: Awaited<ReturnType<typeof releaseCase>>) {
  const released = await snapshot(client, fixture, data.created.id);
  assertFiles(released, null); assert.equal(released.verifiedRelease, true); assert.equal(released.usedBytes, String(bytes));
  const repeated = await retry(fixture, data.request); receipt(repeated, { unlinks: 0, cas: 0, verified: 1 });
  assert.deepEqual(await snapshot(client, fixture, data.created.id), released);
  await data.protectOther();
  await withStoragePolicy({ WORKSPACE_STORAGE_QUOTA_MAX_BYTES: String(bytes * 2) }, async () => {
    await createNoteAttachment({ noteId: data.data.note.id, idempotencyKey: randomUUID(), scan: storageScan() }, data.data.owner.id);
  });
  await denyPrematureUpload(data.data); await data.protectOther();
  return { released, repeated, exactQuotaReuseAfterCommit: true, otherMemberAttachmentUnchanged: true };
}
async function precommit(client: PrismaClient, fixture: StorageQuotaFixture, final: boolean, kill: boolean) {
  const label = `precommit-${kill ? "sigkill" : "commit"}-${final ? "final" : "staging"}`;
  const data = await releaseCase(client, fixture, label, final);
  const child = await prepared(fixture, { ...data.request, point: "cas-precommit" });
  try {
    child.continue(); const inside = await atBarrier(client, child, "cas-precommit");
    assert.equal(inside.state.unlinks, 1); assert.equal(inside.state.cleanupProofs, 1);
    const outside = await outsideBeforeCommit(client, fixture, data);
    let recovery: object;
    if (kill) {
      const rollback = await killAndRollback(client, child, inside.state, data.created.id);
      assert.deepEqual(await outsideBeforeCommit(client, fixture, data), outside);
      const resumed = await retry(fixture, data.request); receipt(resumed, { unlinks: 0, cas: 1, verified: 0 });
      recovery = { ...rollback, resumed };
    } else {
      child.continue(); const committed = await child.finish() as ReleaseReceipt; receipt(committed, { unlinks: 1, cas: 1, verified: 0 });
      recovery = { committed };
    }
    const outcome = await finalState(client, fixture, data);
    if (kill) assert.notEqual(outcome.released.releaseAt, inside.state.releaseAt);
    else assert.equal(outcome.released.releaseAt, inside.state.releaseAt);
    assert.equal(outcome.released.releaseProof, inside.state.releaseProof);
    storageReleaseEvidence.push({ case: label, attachmentId: data.created.id, initial: data.initial, inside, outside, recovery, ...outcome,
      totalUnlinks: 1, committedReleaseCas: 1, absentAndDirectorySyncCompletedBeforeCas: true });
  } finally { await child.close(); }
}
async function concurrent(client: PrismaClient, fixture: StorageQuotaFixture, final: boolean, mode: "commit" | "rollback" | "released") {
  const label = `concurrent-${mode}-${final ? "final" : "staging"}`;
  const data = await releaseCase(client, fixture, label, final);
  const setup = mode === "released" ? await retry(fixture, data.request) : null;
  if (setup) receipt(setup, { unlinks: 1, cas: 1, verified: 0 });
  const point = mode === "released" ? "verified-release" : "cas-precommit";
  const first = await prepared(fixture, { ...data.request, point });
  let second: Child | undefined;
  try {
    second = await prepared(fixture, data.request); assert.notEqual(first.pid, second.pid);
    first.continue(); const inside = await atBarrier(client, first, point);
    assert.equal(inside.state.unlinks, setup ? 0 : 1);
    assert.notEqual(inside.state.backendPid, second.backendPid);
    const outside = setup ? await snapshot(client, fixture, data.created.id) : await outsideBeforeCommit(client, fixture, data);
    second.continue(); const refused = await second.finish() as ReleaseReceipt;
    receipt(refused, { unlinks: 0, cas: 0, verified: 0, result: false });
    assert.ok(second.diagnostics().includes("WORKSPACE_STORAGE_QUOTA_BUSY"));
    const heldAfterCompetitor = await liveTransaction(client, inside.state);
    assert.deepEqual(await snapshot(client, fixture, data.created.id), outside);
    let firstOutcome: object;
    if (mode === "rollback") {
      firstOutcome = await killAndRollback(client, first, inside.state, data.created.id);
      assert.deepEqual(await outsideBeforeCommit(client, fixture, data), outside);
    } else {
      first.continue(); const committed = await first.finish() as ReleaseReceipt;
      receipt(committed, { unlinks: setup ? 0 : 1, cas: setup ? 0 : 1, verified: setup ? 1 : 0 }); firstOutcome = { committed };
    }
    const resumed = await retry(fixture, data.request);
    receipt(resumed, { unlinks: 0, cas: mode === "rollback" ? 1 : 0, verified: mode === "rollback" ? 0 : 1 });
    const outcome = await finalState(client, fixture, data);
    if (mode === "released") assert.deepEqual(outcome.released, outside);
    if (mode === "commit") assert.equal(outcome.released.releaseAt, inside.state.releaseAt);
    if (mode === "rollback") assert.notEqual(outcome.released.releaseAt, inside.state.releaseAt);
    assert.equal(outcome.released.releaseProof, inside.state.releaseProof);
    storageReleaseEvidence.push({ case: label, attachmentId: data.created.id, initial: data.initial, setup, inside, outside,
      competitorPid: second.pid, competitorBackendPid: second.backendPid, refused, refusalCode: "WORKSPACE_STORAGE_QUOTA_BUSY",
      heldAfterCompetitor, firstOutcome, resumed, ...outcome, totalUnlinks: 1, committedReleaseCas: 1,
      competingCasReachable: false, exclusion: "attachment advisory transaction lock precedes row lock and CAS" });
  } finally { await second?.close(); await first.close(); }
}
export async function runStorageReleaseMatrix(client: PrismaClient, fixture: StorageQuotaFixture,
  check: (name: string, run: () => Promise<void>) => Promise<void>) {
  for (const final of [false, true]) for (const kill of [true, false]) {
    await check(`precommit-${kill ? "sigkill" : "commit"}-${final ? "final" : "staging"}`, () => precommit(client, fixture, final, kill));
  }
  for (const final of [false, true]) for (const mode of ["commit", "rollback", "released"] as const) {
    await check(`concurrent-${mode}-${final ? "final" : "staging"}`, () => concurrent(client, fixture, final, mode));
  }
}
