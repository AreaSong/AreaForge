import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { WorkspaceSearchError } from "../../packages/core/src/index";
import { claimQueuedDataJob, commitQueuedDataJob, enqueueWorkspaceSearchIndex, prepareWorkspaceSearchIndex,
  commitWorkspaceSearchIndex, type Prisma, type PrismaClient } from "../../packages/db/src/index";
import { DELETE_FENCE_LOCK } from "../../packages/db/src/data-delete-intents";
import { searchIndexFixtureEnvironment, type SearchIndexFixture } from "./search-index-fixture";
import { createSearchCase, requestSearchCase, consumeSearchCase, querySearchCase, searchSideEffects } from "./search-index-runtime-data";

export async function withSearchLock(client: PrismaClient, lock: (tx: Prisma.TransactionClient) => Promise<unknown>, run: () => Promise<void>) {
  let unlock!: () => void; let acquired!: () => void; let failed!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { acquired = resolve; failed = reject; });
  const release = new Promise<void>(resolve => { unlock = resolve; });
  const holding = client.$transaction(async tx => { await lock(tx); acquired(); await release; }, { timeout: 20_000 });
  void holding.catch(failed);
  try { await ready; await run(); } finally { unlock(); await holding; }
}

export async function searchConcurrentRequests(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "parallel"); const key = randomUUID();
  async function request() {
    for (let attempt = 0; attempt < 20; attempt++) {
      try { return await requestSearchCase(client, data, data.owner, { key, generation: 0 }); }
      catch (error) { if (!(error instanceof WorkspaceSearchError) || !error.retryable || attempt === 19) throw error; await delay(20); }
    }
    throw new Error("CONCURRENT_REQUEST_RETRY_EXHAUSTED");
  }
  const jobs = await Promise.all([request(), request(), request()]);
  assert.equal(new Set(jobs.map(job => job.id)).size, 1); assert.equal(await client.dataJob.count({ where: { workspaceId: data.workspace.id } }), 1);
  const leases = await Promise.all(["search-one", "search-two"].map(workerId => claimQueuedDataJob(client,
    { workerId, kinds: ["SEARCH_INDEX_REBUILD"], leaseMs: 30_000, partition: { workspaceId: data.workspace.id } })));
  assert.equal(leases.filter(Boolean).length, 1);
}

export async function searchPartitionLockFallback(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "index-lock");
  await requestSearchCase(client, data); assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
  await withSearchLock(client, tx => tx.$queryRaw`SELECT id FROM "WorkspaceSearchPartition"
    WHERE "userId"=${data.owner.id} AND "workspaceId"=${data.workspace.id} FOR UPDATE`, async () => {
    await client.note.update({ where: { id: data.own.note.id }, data: { title: "SEARCH fresh safe fallback" } });
    const result = await querySearchCase(data); assert.equal(result.indexed, false); assert.equal(result.indexedAt, null);
    assert.equal(result.results.find(row => row.id === data.own.note.id)?.label, "SEARCH fresh safe fallback");
    await client.authSession.update({ where: { id: data.owner.sessionId }, data: { revokedAt: new Date() } });
    await assert.rejects(querySearchCase(data), /SESSION_REVOKED/);
  });
}

export async function searchDeleteBarrier(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "delete-barrier"); const job = await requestSearchCase(client, data);
  await withSearchLock(client, tx => tx.$executeRaw`SELECT pg_advisory_xact_lock(${DELETE_FENCE_LOCK})`, async () => {
    const start = Date.now(); assert.deepEqual(await consumeSearchCase(client, data), []);
    await assert.rejects(querySearchCase(data), /BUSY/); assert.ok(Date.now() - start < 3000);
    assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).status, "QUEUED");
  });
  assert.deepEqual(await consumeSearchCase(client, data), ["SUCCEEDED"]);
}

export async function searchGates(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "gates"); const job = await requestSearchCase(client, data);
  const lease = await claimQueuedDataJob(client, { workerId: "search-gates", kinds: ["SEARCH_INDEX_REBUILD"], leaseMs: 30_000, partition: { workspaceId: data.workspace.id } });
  assert.ok(lease); const env = searchIndexFixtureEnvironment(fixture);
  const fingerprint = await prepareWorkspaceSearchIndex(client, lease, env);
  for (const key of ["AUTH_MULTI_USER_ENABLED", "AUTH_RBAC_ENABLED", "SEARCH_INDEX_ENABLED", "SEARCH_INDEX_QUEUE_ENABLED", "DATA_JOB_WORKER_ENABLED"]) {
    for (const value of [undefined, "false", "TRUE"]) {
      const disabled = { ...env, [key]: value };
      await assert.rejects(enqueueWorkspaceSearchIndex(client, { actorId: data.owner.id, sessionId: data.owner.sessionId,
        workspaceId: data.workspace.id, expectedGeneration: 1, idempotencyKey: randomUUID() }, disabled), /DISABLED/);
      await assert.rejects(prepareWorkspaceSearchIndex(client, lease, disabled), /DISABLED/);
      await assert.rejects(commitQueuedDataJob(client, { lease, effect: (tx, row) => commitWorkspaceSearchIndex(tx, row, fingerprint, disabled) }), /DISABLED/);
    }
  }
  assert.deepEqual(await searchSideEffects(client, data), { effects: 0, documents: 0 });
  await commitQueuedDataJob(client, { lease, effect: (tx, row) => commitWorkspaceSearchIndex(tx, row, fingerprint, env) });
  assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).status, "SUCCEEDED");
}

export async function searchConfiguredCli(client: PrismaClient, fixture: SearchIndexFixture) {
  const data = await createSearchCase(client, fixture, "configured-cli"); const job = await requestSearchCase(client, data);
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../workers/data-job-worker.ts", import.meta.url)), "--once", `--workspace=${data.workspace.id}`],
    { env: searchIndexFixtureEnvironment(fixture), stdio: ["ignore", "ignore", "ignore"] });
  const exit = await new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
  assert.equal(exit, 0); assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).status, "SUCCEEDED");
  assert.equal((await querySearchCase(data)).indexed, true);
}
