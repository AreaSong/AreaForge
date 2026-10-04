import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { RankingRebuildError } from "../../packages/core/src/index";
import { claimQueuedDataJob, recoverQueuedDataJobs, getSafeRankingProjection, type PrismaClient } from "../../packages/db/src/index";
import { DELETE_FENCE_LOCK } from "../../packages/db/src/data-delete-intents";
import { rankingFixtureEnvironment, type RankingRebuildFixture } from "./ranking-rebuild-fixture";
import { createRankingCase, requestRankingCase, consumeRankingCase, rankingSideEffects } from "./ranking-rebuild-runtime-data";
import { startRankingFixtureWorker } from "./ranking-rebuild-process";

export async function rankingConcurrentRequests(client: PrismaClient, fixture: RankingRebuildFixture) {
  const data = await createRankingCase(client, fixture, "parallel"); const key = randomUUID();
  async function request() {
    for (let attempt = 0; attempt < 20; attempt++) {
      try { return await requestRankingCase(client, data, key); }
      catch (error) { if (!(error instanceof RankingRebuildError) || !error.retryable || attempt === 19) throw error; await delay(20); }
    }
    throw new Error("CONCURRENT_REQUEST_RETRY_EXHAUSTED");
  }
  const jobs = await Promise.all([request(), request(), request()]);
  assert.equal(new Set(jobs.map(job => job.id)).size, 1); assert.equal(await client.dataJob.count({ where: { workspaceId: data.workspace.id } }), 1);
  const leases = await Promise.all(["one", "two"].map(workerId => claimQueuedDataJob(client,
    { workerId, kinds: ["RANKING_REBUILD"], leaseMs: 30_000, partition: { workspaceId: data.workspace.id } })));
  assert.equal(leases.filter(Boolean).length, 1);
}

export async function rankingDeleteFenceConflict(client: PrismaClient, fixture: RankingRebuildFixture) {
  const data = await createRankingCase(client, fixture, "delete-lock"); const job = await requestRankingCase(client, data);
  let unlock!: () => void; let acquired!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const release = new Promise<void>(resolve => { unlock = resolve; });
  const holding = client.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DELETE_FENCE_LOCK})`; acquired(); await release; }, { timeout: 5000 });
  try {
    await ready; const started = Date.now(); assert.deepEqual(await consumeRankingCase(client, data), []);
    assert.ok(Date.now() - started < 2000); assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).status, "QUEUED");
  } finally { unlock(); await holding; }
  assert.deepEqual(await consumeRankingCase(client, data), ["SUCCEEDED"]);
}

export async function rankingMembershipLockConflict(client: PrismaClient, fixture: RankingRebuildFixture) {
  const data = await createRankingCase(client, fixture, "scope-lock"); await requestRankingCase(client, data);
  let unlock!: () => void; let acquired!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; }); const release = new Promise<void>(resolve => { unlock = resolve; });
  const holding = client.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "WorkspaceMembership" WHERE "workspaceId"=${data.workspace.id} AND "userId"=${data.owner.id} FOR UPDATE`;
    acquired(); await release;
    await tx.examWorkspace.update({ where: { id: data.workspace.id }, data: { revision: { increment: 1 } } });
  }, { timeout: 5000 });
  try { await ready; const started = Date.now(); assert.deepEqual(await consumeRankingCase(client, data), []); assert.ok(Date.now() - started < 2000); }
  finally { unlock(); await holding; }
  assert.deepEqual(await consumeRankingCase(client, data), ["FAILED"]);
  assert.equal((await rankingSideEffects(client, data)).effects, 0);
}

export async function rankingPreparedSourceDrift(client: PrismaClient, fixture: RankingRebuildFixture) {
  const data = await createRankingCase(client, fixture, "prepared-source"); const job = await requestRankingCase(client, data);
  const worker = startRankingFixtureWorker(fixture, job.id, "prepared");
  try {
    await worker.waitFor("prepared");
    await client.studySession.update({ where: { id: data.sessions[0]!.id }, data: { effectiveMinutes: 1 } });
    worker.continue(); assert.equal((await worker.done).code, 0);
    assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).errorCode, "RANKING_REBUILD_SNAPSHOT_CHANGED");
    assert.equal((await rankingSideEffects(client, data)).effects, 0);
  } finally { worker.stop(); await worker.done; }
}

export async function rankingBudgetRefusal(client: PrismaClient, fixture: RankingRebuildFixture) {
  const data = await createRankingCase(client, fixture, "budget");
  for (let offset = 0; offset < 10_000; offset += 1000) {
    await client.studySession.createMany({ data: Array.from({ length: 1000 }, () => ({ userId: data.owner.id, workspaceId: data.workspace.id,
      subjectId: data.subject.id, status: "COMPLETED" as const, startedAt: new Date("2026-09-14T08:00:00Z"), endedAt: new Date("2026-09-14T08:01:00Z"), effectiveMinutes: 1 })) });
  }
  await assert.rejects(requestRankingCase(client, data), /SESSION_LIMIT/);
  assert.equal(await client.dataJob.count({ where: { workspaceId: data.workspace.id } }), 0);
  assert.equal((await rankingSideEffects(client, data)).effects, 0);
}

export async function rankingConfiguredCli(client: PrismaClient, fixture: RankingRebuildFixture) {
  const data = await createRankingCase(client, fixture, "configured-cli"); const job = await requestRankingCase(client, data);
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../workers/data-job-worker.ts", import.meta.url)), "--once", `--workspace=${data.workspace.id}`],
    { env: rankingFixtureEnvironment(fixture), stdio: ["ignore", "ignore", "ignore"] });
  const exit = await new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  assert.equal(exit, 0); assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).status, "SUCCEEDED");
  assert.equal((await getSafeRankingProjection(client, data.member.id, data.challenge.id)).entries.length, 2);
}

export async function rankingOrderingAndEmptyPublication(client: PrismaClient, fixture: RankingRebuildFixture) {
  const data = await createRankingCase(client, fixture, "ordering");
  await client.studySession.update({ where: { id: data.sessions[0]!.id }, data: { effectiveMinutes: 1, isEffective: false } });
  await client.studySession.update({ where: { id: data.sessions[1]!.id }, data: { effectiveMinutes: 60, isEffective: true } });
  await requestRankingCase(client, data); assert.deepEqual(await consumeRankingCase(client, data), ["SUCCEEDED"]);
  const projection = await getSafeRankingProjection(client, data.owner.id, data.challenge.id);
  assert.equal(projection.entries.length, 2); assert.ok(projection.entries[0]!.fields.score! > projection.entries[1]!.fields.score!);
  assert.equal(projection.entries[0]!.rank, 1);

  const empty = await createRankingCase(client, fixture, "empty-publication", "synthetic-not-login", true);
  await client.studySession.update({ where: { id: empty.sessions[0]!.id }, data: { endedAt: new Date("2026-09-16T08:00:00Z"), effectiveMinutes: 2880 } });
  const before = await getSafeRankingProjection(client, empty.owner.id, empty.challenge.id); assert.equal(before.stale, true);
  await requestRankingCase(client, empty); assert.deepEqual(await consumeRankingCase(client, empty), ["SUCCEEDED"]);
  const after = await getSafeRankingProjection(client, empty.owner.id, empty.challenge.id);
  assert.equal(after.entries.length, 0); assert.equal(after.stale, false);
}
