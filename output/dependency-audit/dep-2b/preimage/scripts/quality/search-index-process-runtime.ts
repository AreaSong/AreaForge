import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { commitQueuedDataJob, controlWorkspaceSearchIndex, recoverQueuedDataJobs, type PrismaClient } from "../../packages/db/src/index";
import { toDataJobLease } from "../../packages/db/src/data-job-queue-store";
import { createSearchCase, requestSearchCase, consumeSearchCase, querySearchCase, searchSideEffects } from "./search-index-runtime-data";
import { startSearchFixtureWorker } from "./search-index-process";
import type { SearchIndexFixture } from "./search-index-fixture";

export async function searchProcessCrashRecovery(client: PrismaClient, fixture: SearchIndexFixture) {
  for (const point of ["prepared", "written"] as const) {
    const data = await createSearchCase(client, fixture, `kill-${point}`);
    await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
    const before = await searchSideEffects(client, data); const job = await requestSearchCase(client, data);
    const worker = startSearchFixtureWorker(fixture, job.id, point);
    try {
      await worker.waitFor(point); assert.deepEqual(await searchSideEffects(client, data), before);
    } finally { worker.stop(); assert.equal((await worker.done).signal, "SIGKILL"); }
    const row = await client.dataJob.findUniqueOrThrow({ where: { id: job.id } }); const oldLease = toDataJobLease(row);
    assert.equal(row.status, "RUNNING"); assert.deepEqual(await searchSideEffects(client, data), before);
    await client.dataJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    await recoverQueuedDataJobs(client, { kinds: ["SEARCH_INDEX_REBUILD"], partition: { workspaceId: data.workspace.id } });
    await client.dataJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
    const final = await client.dataJob.findUniqueOrThrow({ where: { id: job.id } }); assert.ok(final.leaseVersion > oldLease.leaseVersion);
    assert.deepEqual(await searchSideEffects(client, data), { documents: before.documents, effects: before.effects + 1 });
    assert.equal((await querySearchCase(data)).indexed, true);
    await assert.rejects(commitQueuedDataJob(client, { lease: oldLease, effect: async () => { throw new Error("OLD_EFFECT_RAN"); } }), /LEASE_LOST/);
  }
}

export async function searchRunningControl(client: PrismaClient, fixture: SearchIndexFixture) {
  for (const action of ["PAUSE", "CANCEL"] as const) {
    const data = await createSearchCase(client, fixture, `running-${action}`); const job = await requestSearchCase(client, data);
    const worker = startSearchFixtureWorker(fixture, job.id, "prepared");
    try {
      await worker.waitFor("prepared"); const row = await client.dataJob.findUniqueOrThrow({ where: { id: job.id } });
      const controlled = await controlWorkspaceSearchIndex(client, { actorId: data.owner.id, sessionId: data.owner.sessionId, workspaceId: data.workspace.id,
        jobId: job.id, expectedRevision: row.updatedAt.getTime(), action });
      if (action === "PAUSE") { assert.equal(controlled.status, "RUNNING"); assert.equal(controlled.pauseRequested, true); }
      else assert.equal(controlled.status, "CANCEL_REQUESTED");
      worker.continue(); assert.equal((await worker.done).code, 0);
      const final = await client.dataJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(final.status, action === "PAUSE" ? "PAUSED" : "CANCELLED"); assert.equal((await searchSideEffects(client, data)).effects, 0);
      if (action === "PAUSE") {
        await controlWorkspaceSearchIndex(client, { actorId: data.owner.id, sessionId: data.owner.sessionId, workspaceId: data.workspace.id,
          jobId: job.id, expectedRevision: final.updatedAt.getTime(), action: "RESUME" });
        assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
      }
    } finally { worker.stop(); await worker.done; }
  }
}

export async function searchLeaseExpiresDuringCommit(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "commit-expiry"); const job = await requestSearchCase(client, data);
  const worker = startSearchFixtureWorker(fixture, job.id, "written", { leaseMs: 1000 });
  try {
    await worker.waitFor("written"); await delay(1200); worker.continue(); assert.equal((await worker.done).code, 0);
    assert.deepEqual(await searchSideEffects(client, data), { effects: 0, documents: 0 });
    await recoverQueuedDataJobs(client, { kinds: ["SEARCH_INDEX_REBUILD"], partition: { workspaceId: data.workspace.id } });
    await client.dataJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
  } finally { worker.stop(); await worker.done; }
}

export async function searchPreparedSourceDrift(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "prepared-source"); const job = await requestSearchCase(client, data);
  const worker = startSearchFixtureWorker(fixture, job.id, "prepared");
  try {
    await worker.waitFor("prepared");
    await client.note.update({ where: { id: data.own.note.id }, data: { title: "SEARCH changed after prepare" } });
    worker.continue(); assert.equal((await worker.done).code, 0);
    assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).errorCode, "SEARCH_INDEX_SNAPSHOT_CHANGED");
    assert.deepEqual(await searchSideEffects(client, data), { effects: 0, documents: 0 });
  } finally { worker.stop(); await worker.done; }
}

export async function searchCommitTailInvalidation(client: PrismaClient, fixture: SearchIndexFixture) {
  for (const change of ["source", "grant-expiry"] as const) {
    const data = await createSearchCase(client, fixture, `commit-tail-${change}`);
    const expiresAt = new Date(Date.now() + 8_000);
    if (change === "grant-expiry") await client.workspaceShareGrant.update({ where: { id: data.grants[0]!.id },
      data: { expiresAt, revision: { increment: 1 } } });
    const job = await requestSearchCase(client, data);
    const worker = startSearchFixtureWorker(fixture, job.id, "written");
    try {
      await worker.waitFor("written");
      if (change === "source") await client.note.update({ where: { id: data.own.note.id }, data: { title: "SEARCH commit-tail current title" } });
      else {
        assert.ok(Date.now() < expiresAt.getTime(), "授权须在写入检查点之后到期");
        await delay(expiresAt.getTime() - Date.now() + 25);
      }
      worker.continue(); assert.equal((await worker.done).code, 0);
      const final = await client.dataJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.ok(["SUCCEEDED", "QUEUED", "FAILED"].includes(final.status));
      // 源变更可序列化到发布之后；成功回执不等于该代索引仍有当前读取权限。
      assert.deepEqual(await searchSideEffects(client, data), final.status === "SUCCEEDED"
        ? { effects: 1, documents: 8 } : { effects: 0, documents: 0 });
      const result = await querySearchCase(data);
      assert.equal(result.indexed, false); assert.equal(result.indexedAt, null);
      assert.equal(result.indexState, final.status === "SUCCEEDED" ? "STALE" : "MISSING");
      if (change === "source") assert.equal(result.results.find(row => row.id === data.own.note.id)?.label, "SEARCH commit-tail current title");
      else assert.equal(result.results.some(row => row.id === data.foreign.note.id), false);
    } finally { worker.stop(); await worker.done; }
  }
}
