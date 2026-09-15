import assert from "node:assert/strict";
import { commitQueuedDataJob, controlRankingRebuild, recoverQueuedDataJobs, type PrismaClient } from "../../packages/db/src/index";
import { toDataJobLease } from "../../packages/db/src/data-job-queue-store";
import { createRankingCase, requestRankingCase, consumeRankingCase, rankingSideEffects } from "./ranking-rebuild-runtime-data";
import { startRankingFixtureWorker } from "./ranking-rebuild-process";
import type { RankingRebuildFixture } from "./ranking-rebuild-fixture";
import { setTimeout as delay } from "node:timers/promises";

export async function rankingProcessCrashRecovery(client: PrismaClient, fixture: RankingRebuildFixture) {
  for (const point of ["prepared", "written"] as const) {
    const data = await createRankingCase(client, fixture, `kill-${point}`); const job = await requestRankingCase(client, data);
    const worker = startRankingFixtureWorker(fixture, job.id, point);
    try {
      await worker.waitFor(point);
      assert.equal((await rankingSideEffects(client, data)).effects, 0);
      assert.equal((await rankingSideEffects(client, data)).projections, 0);
    } finally { worker.stop(); assert.equal((await worker.done).signal, "SIGKILL"); }
    const row = await client.dataJob.findUniqueOrThrow({ where: { id: job.id } }); const oldLease = toDataJobLease(row);
    assert.equal(row.status, "RUNNING");
    await client.dataJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    await recoverQueuedDataJobs(client, { kinds: ["RANKING_REBUILD"], partition: { workspaceId: data.workspace.id } });
    await client.dataJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    assert.deepEqual(await consumeRankingCase(client, data), ["SUCCEEDED"]);
    const final = await client.dataJob.findUniqueOrThrow({ where: { id: job.id } }); assert.ok(final.leaseVersion > oldLease.leaseVersion);
    assert.equal((await rankingSideEffects(client, data)).effects, 1);
    await assert.rejects(commitQueuedDataJob(client, { lease: oldLease, effect: async () => { throw new Error("OLD_EFFECT_RAN"); } }), /LEASE_LOST/);
  }
}

export async function rankingRunningControl(client: PrismaClient, fixture: RankingRebuildFixture) {
  for (const action of ["PAUSE", "CANCEL"] as const) {
    const data = await createRankingCase(client, fixture, `running-${action}`); const job = await requestRankingCase(client, data);
    const worker = startRankingFixtureWorker(fixture, job.id, "prepared");
    try {
      await worker.waitFor("prepared"); const row = await client.dataJob.findUniqueOrThrow({ where: { id: job.id } });
      const controlled = await controlRankingRebuild(client, { actorId: data.owner.id, sessionId: data.owner.sessionId, challengeId: data.challenge.id,
        jobId: job.id, expectedRevision: row.updatedAt.getTime(), action });
      if (action === "PAUSE") { assert.equal(controlled.status, "RUNNING"); assert.equal(controlled.pauseRequested, true); }
      else assert.equal(controlled.status, "CANCEL_REQUESTED");
      worker.continue(); assert.equal((await worker.done).code, 0);
      const final = await client.dataJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(final.status, action === "PAUSE" ? "PAUSED" : "CANCELLED"); assert.equal((await rankingSideEffects(client, data)).effects, 0);
      if (action === "PAUSE") {
        await controlRankingRebuild(client, { actorId: data.owner.id, sessionId: data.owner.sessionId, challengeId: data.challenge.id,
          jobId: job.id, expectedRevision: final.updatedAt.getTime(), action: "RESUME" });
        assert.deepEqual(await consumeRankingCase(client, data), ["SUCCEEDED"]);
      }
    } finally { worker.stop(); await worker.done; }
  }
}

export async function rankingRunningDisable(client: PrismaClient, fixture: RankingRebuildFixture) {
  const data = await createRankingCase(client, fixture, "running-disabled"); const job = await requestRankingCase(client, data);
  const worker = startRankingFixtureWorker(fixture, job.id, "prepared");
  try {
    await worker.waitFor("prepared"); worker.disable(); worker.continue(); assert.equal((await worker.done).code, 0);
    const final = await client.dataJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(final.status, "FAILED"); assert.equal(final.errorCode, "RANKING_REBUILD_DISABLED");
    assert.equal((await rankingSideEffects(client, data)).effects, 0);
  } finally { worker.stop(); await worker.done; }
}

export async function rankingLeaseExpiresDuringCommit(client: PrismaClient, fixture: RankingRebuildFixture) {
  const data = await createRankingCase(client, fixture, "commit-expiry"); const job = await requestRankingCase(client, data);
  const worker = startRankingFixtureWorker(fixture, job.id, "written", { leaseMs: 1000 });
  try {
    await worker.waitFor("written"); await delay(1200); worker.continue(); assert.equal((await worker.done).code, 0);
    assert.equal((await rankingSideEffects(client, data)).effects, 0); assert.equal((await rankingSideEffects(client, data)).projections, 0);
    await recoverQueuedDataJobs(client, { kinds: ["RANKING_REBUILD"], partition: { workspaceId: data.workspace.id } });
    await client.dataJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    assert.deepEqual(await consumeRankingCase(client, data), ["SUCCEEDED"]); assert.equal((await rankingSideEffects(client, data)).effects, 1);
  } finally { worker.stop(); await worker.done; }
}
