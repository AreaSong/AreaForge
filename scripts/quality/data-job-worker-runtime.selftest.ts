import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  prisma, claimQueuedDataJob, commitQueuedDataJob, controlQueuedDataJob, failQueuedDataJob,
  getDataJobQueueSnapshot, heartbeatQueuedDataJob, recoverQueuedDataJobs, type DataJobLease,
} from "../../packages/db/src/index";
import { executeDataJob } from "../workers/data-job-execution";
import { runDataJobWorker } from "../workers/data-job-runner";
import {
  fixtureJob, makeFixtureLeaseStale, makeFixtureRetryDue, requireDataJobWorkerFixture,
  seedDataJobWorkerFixture, syntheticQueueEffect, verifyDataJobWorkerMigrations, waitForFixture, type WorkerFixture,
} from "./data-job-worker-runtime-fixture";

const partition = (fixture: WorkerFixture) => ({ requestedByUserId: fixture.owner.id });
const read = (id: string) => prisma.dataJob.findUniqueOrThrow({ where: { id } });
const effectCount = (jobId: string) => prisma.auditEvent.count({ where: { id: `effect_${jobId}` } });
const recover = (fixture: WorkerFixture) => recoverQueuedDataJobs(prisma, { kinds: ["NOTIFICATION"], partition: partition(fixture) });
const claim = (fixture: WorkerFixture, workerId = "worker-a") => claimQueuedDataJob(prisma, {
  workerId, kinds: ["NOTIFICATION"], leaseMs: 30_000, partition: partition(fixture),
});
async function leaseFor(fixture: WorkerFixture, workerId?: string): Promise<DataJobLease> {
  const lease = await claim(fixture, workerId);
  assert.ok(lease);
  return lease;
}
async function control(fixture: WorkerFixture, jobId: string, action: "PAUSE" | "RESUME" | "CANCEL" | "REPLAY") {
  return controlQueuedDataJob(prisma, { jobId, actorId: fixture.owner.id, expectedRevision: (await read(jobId)).updatedAt.getTime(), action });
}

async function verifyClaimsAndIdempotency(fixture: WorkerFixture) {
  const jobs = await Promise.all(Array.from({ length: 8 }, () => fixtureJob(fixture, "same-request")));
  assert.equal(new Set(jobs.map((job) => job.id)).size, 1);
  await assert.rejects(fixtureJob(fixture, "same-request", { requestFingerprint: "b".repeat(64) }), /DATA_JOB_IDEMPOTENCY_CONFLICT/);
  const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => claim(fixture, `worker-${index}`)));
  assert.equal(claims.filter(Boolean).length, 1);
  const lease = claims.find((value): value is DataJobLease => value !== null)!;
  assert.equal(lease.attempt, 1);
  await assert.rejects(commitQueuedDataJob(prisma, { lease: { ...lease, workspaceId: fixture.workspaceB.id }, effect: syntheticQueueEffect }), /DATA_JOB_LEASE_LOST/);
  await commitQueuedDataJob(prisma, { lease, effect: syntheticQueueEffect });
  await assert.rejects(commitQueuedDataJob(prisma, { lease, effect: syntheticQueueEffect }), /DATA_JOB_LEASE_LOST/);
  assert.equal(await effectCount(lease.jobId), 1);
}

async function verifySkipLockedAndPartition(fixture: WorkerFixture) {
  const first = await fixtureJob(fixture, "locked-first");
  const second = await fixtureJob(fixture, "other-workspace", { workspaceId: fixture.workspaceB.id });
  let locked!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { locked = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const transaction = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "DataJob" WHERE id = ${first.id} FOR UPDATE`;
    locked();
    await held;
  });
  try {
    await ready;
    const lease = await leaseFor(fixture);
    assert.equal(lease.jobId, second.id);
    await commitQueuedDataJob(prisma, { lease, effect: syntheticQueueEffect });
  } finally {
    release();
    await transaction;
  }
  assert.equal(await claimQueuedDataJob(prisma, { workerId: "isolated", kinds: ["NOTIFICATION"], leaseMs: 30_000, partition: { workspaceId: fixture.workspaceB.id } }), null);
  assert.equal((await leaseFor(fixture)).jobId, first.id);
}

async function verifyRecoveryAndFencing(fixture: WorkerFixture) {
  const job = await fixtureJob(fixture, "crashed-lease");
  const old = await leaseFor(fixture, "same-worker-name");
  await makeFixtureLeaseStale(job.id);
  assert.equal(await recover(fixture), 1);
  const failed = await read(job.id);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.errorCode, "LEASE_EXPIRED");
  assert.ok(failed.nextAttemptAt && failed.nextAttemptAt.getTime() > Date.now() + 25_000);
  assert.equal(await claim(fixture), null);
  await makeFixtureRetryDue(job.id);
  const fresh = await leaseFor(fixture, "same-worker-name");
  assert.ok(fresh.leaseVersion > old.leaseVersion);
  await assert.rejects(heartbeatQueuedDataJob(prisma, { lease: old, leaseMs: 30_000 }), /DATA_JOB_LEASE_LOST/);
  await assert.rejects(commitQueuedDataJob(prisma, { lease: old, effect: syntheticQueueEffect }), /DATA_JOB_LEASE_LOST/);
  await commitQueuedDataJob(prisma, { lease: fresh, effect: syntheticQueueEffect });
  assert.equal(await effectCount(job.id), 1);
}

async function verifyDeadLetterAndReplay(fixture: WorkerFixture) {
  const job = await fixtureJob(fixture, "bounded-retries", { maxAttempts: 2 });
  const first = await leaseFor(fixture);
  await failQueuedDataJob(prisma, { lease: first, errorCode: "TEMPORARY_FAILURE", retryable: true });
  await makeFixtureRetryDue(job.id);
  const second = await leaseFor(fixture);
  await failQueuedDataJob(prisma, { lease: second, errorCode: "TEMPORARY_FAILURE", retryable: true });
  const dead = await read(job.id);
  assert.equal(dead.attempt, 2);
  assert.equal(dead.retryable, false);
  assert.ok(dead.deadLetteredAt);
  assert.equal(dead.nextAttemptAt, null);
  assert.equal(await claim(fixture), null);
  await assert.rejects(controlQueuedDataJob(prisma, { jobId: job.id, actorId: fixture.other.id, expectedRevision: dead.updatedAt.getTime(), action: "REPLAY" }), /DATA_JOB_QUEUE_NOT_FOUND/);
  await assert.rejects(controlQueuedDataJob(prisma, { jobId: job.id, actorId: fixture.owner.id, expectedRevision: 0, action: "REPLAY" }), /DATA_JOB_REVISION_CONFLICT/);
  await control(fixture, job.id, "REPLAY");
  const replay = await leaseFor(fixture);
  assert.equal(replay.attempt, 1);
  assert.ok(replay.leaseVersion > second.leaseVersion);
  await assert.rejects(commitQueuedDataJob(prisma, { lease: second, effect: syntheticQueueEffect }), /DATA_JOB_LEASE_LOST/);
  await commitQueuedDataJob(prisma, { lease: replay, effect: syntheticQueueEffect });
}

async function verifyPauseAndCancel(fixture: WorkerFixture) {
  const job = await fixtureJob(fixture, "control", { maxAttempts: 1 });
  await control(fixture, job.id, "PAUSE");
  assert.equal(await claim(fixture), null);
  await control(fixture, job.id, "RESUME");
  const lease = await leaseFor(fixture);
  await control(fixture, job.id, "PAUSE");
  assert.equal(await heartbeatQueuedDataJob(prisma, { lease, leaseMs: 30_000 }), "PAUSED");
  assert.equal((await read(job.id)).attempt, 0);
  await assert.rejects(commitQueuedDataJob(prisma, { lease, effect: syntheticQueueEffect }), /DATA_JOB_LEASE_LOST/);
  await control(fixture, job.id, "RESUME");
  const resumed = await leaseFor(fixture);
  await control(fixture, job.id, "CANCEL");
  assert.equal(await commitQueuedDataJob(prisma, { lease: resumed, effect: syntheticQueueEffect }), "CANCELLED");
  assert.equal(await effectCount(job.id), 0);
  const abandoned = await fixtureJob(fixture, "cancel-abandoned");
  await leaseFor(fixture);
  await control(fixture, abandoned.id, "CANCEL");
  await makeFixtureLeaseStale(abandoned.id);
  await recover(fixture);
  assert.equal((await read(abandoned.id)).status, "CANCELLED");
}

async function verifyLegacyProtocolAndScopeChecks(fixture: WorkerFixture) {
  const legacy = await prisma.dataJob.create({ data: {
    kind: "EXPORT", scope: "ACCOUNT", requestedByUserId: fixture.owner.id, idempotencyKey: `${fixture.prefix}_legacy`,
    requestFingerprint: "f".repeat(64), expiresAt: new Date(Date.now() + 60_000),
  } });
  assert.equal(legacy.queueVersion, 0);
  await assert.rejects(prisma.dataJob.update({ where: { id: legacy.id }, data: { maxAttempts: 0 } }), /DataJob_queue_bounds_check/);
  await assert.rejects(prisma.dataJob.update({ where: { id: legacy.id }, data: { leaseVersion: -1 } }), /DataJob_queue_bounds_check/);
  await assert.rejects(prisma.dataJob.update({ where: { id: legacy.id }, data: { queueVersion: 1, scope: "WORKSPACE" } }), /DataJob_queue_scope_check/);
  assert.equal(await claimQueuedDataJob(prisma, { workerId: "protocol", kinds: ["EXPORT"], leaseMs: 30_000, partition: partition(fixture) }), null);
  await assert.rejects(fixtureJob(fixture, "invalid-scope", { scope: "ACCOUNT", workspaceId: fixture.workspaceA.id }), /DATA_JOB_SCOPE_INVALID/);
  await assert.rejects(fixtureJob(fixture, "unauthorized-workspace", { requestedByUserId: fixture.other.id }), /DATA_JOB_SCOPE_REVOKED/);
  const paused = await fixtureJob(fixture, "paused-expiry");
  await control(fixture, paused.id, "PAUSE");
  await prisma.dataJob.update({ where: { id: paused.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
  await recover(fixture);
  assert.equal((await read(paused.id)).status, "EXPIRED");
  assert.equal((await read(legacy.id)).status, "QUEUED");
}

async function verifyTransactionalRollback(fixture: WorkerFixture) {
  const job = await fixtureJob(fixture, "atomic-effect");
  const lease = await leaseFor(fixture);
  const result = await executeDataJob({ client: prisma, lease, leaseMs: 30_000, signal: new AbortController().signal,
    handler: { kind: "NOTIFICATION", prepare: async () => async (tx, record) => {
      await syntheticQueueEffect(tx, record);
      throw new Error("private exception body must never be stored");
    } },
  });
  assert.equal(result, "FAILED");
  assert.equal(await effectCount(job.id), 0);
  assert.equal((await read(job.id)).errorCode, "DATA_JOB_HANDLER_FAILED");
  await makeFixtureRetryDue(job.id);
  await runDataJobWorker({ enabled: true, client: prisma, workerId: "retry-process", partition: partition(fixture), once: true,
    signal: new AbortController().signal, handlers: [{ kind: "NOTIFICATION", prepare: async () => syntheticQueueEffect }],
  });
  assert.equal((await read(job.id)).status, "SUCCEEDED");
  assert.equal(await effectCount(job.id), 1);
}

async function verifyRevocationAndExpiry(fixture: WorkerFixture) {
  const job = await fixtureJob(fixture, "scope-revoked");
  const lease = await leaseFor(fixture);
  await prisma.workspaceMembership.update({ where: { workspaceId_userId: { workspaceId: fixture.workspaceA.id, userId: fixture.owner.id } }, data: { status: "REMOVED" } });
  await assert.rejects(commitQueuedDataJob(prisma, { lease, effect: syntheticQueueEffect }), /DATA_JOB_SCOPE_REVOKED/);
  assert.equal(await effectCount(job.id), 0);
  await failQueuedDataJob(prisma, { lease, errorCode: "DATA_JOB_SCOPE_REVOKED", retryable: false });
  const expiring = await fixtureJob(fixture, "expires", { scope: "ACCOUNT", workspaceId: null });
  await prisma.dataJob.update({ where: { id: expiring.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
  await recover(fixture);
  assert.equal((await read(expiring.id)).status, "EXPIRED");
  const suspended = await fixtureJob(fixture, "suspended-requester", { scope: "ACCOUNT", workspaceId: null });
  await prisma.user.update({ where: { id: fixture.owner.id }, data: { status: "SUSPENDED" } });
  assert.equal(await claim(fixture), null);
  assert.equal((await read(suspended.id)).errorCode, "DATA_JOB_SCOPE_REVOKED");
  const snapshot = await getDataJobQueueSnapshot(prisma, partition(fixture));
  assert.equal(snapshot.deadLetters, 2);
  assert.equal(snapshot.states.EXPIRED, 1);
  assert.equal("leaseOwner" in snapshot, false);
}

async function verifyHeartbeatAndAbort(fixture: WorkerFixture) {
  const job = await fixtureJob(fixture, "long-prepare");
  const controller = new AbortController();
  const worker = runDataJobWorker({ enabled: true, client: prisma, workerId: "heartbeat", leaseMs: 1_000,
    partition: partition(fixture), signal: controller.signal, once: true,
    handlers: [{ kind: "NOTIFICATION", prepare: async ({ heartbeat }) => {
      await heartbeat(0.5);
      await heartbeat(0.25);
      await delay(1_300);
      assert.equal(await recover(fixture), 0);
      assert.equal((await read(job.id)).progress, 0.5);
      return syntheticQueueEffect;
    } }],
  });
  await worker;
  assert.equal((await read(job.id)).status, "SUCCEEDED");
  const interrupted = await fixtureJob(fixture, "shutdown");
  const stopped = new AbortController();
  const running = runDataJobWorker({ enabled: true, client: prisma, workerId: "shutdown", partition: partition(fixture), signal: stopped.signal, once: true,
    handlers: [{ kind: "NOTIFICATION", prepare: async () => { stopped.abort(); await new Promise(() => undefined); return syntheticQueueEffect; } }],
  });
  await running;
  assert.equal((await read(interrupted.id)).status, "FAILED");
  assert.equal((await read(interrupted.id)).errorCode, "DATA_JOB_WORKER_STOPPED");
  assert.equal(await effectCount(interrupted.id), 0);
}

async function verifyRunnerControls(fixture: WorkerFixture) {
  for (const action of ["PAUSE", "CANCEL"] as const) {
    const job = await fixtureJob(fixture, `runner-${action}`);
    const outcomes: string[] = [];
    const running = runDataJobWorker({ enabled: true, client: prisma, workerId: "controlled-runner", leaseMs: 1_000,
      partition: partition(fixture), signal: new AbortController().signal, once: true,
      handlers: [{ kind: "NOTIFICATION", prepare: async () => { await new Promise(() => undefined); return syntheticQueueEffect; } }],
      onResult: (result) => outcomes.push(result),
    });
    await waitForFixture(async () => (await read(job.id)).status === "RUNNING");
    await control(fixture, job.id, action);
    await running;
    assert.deepEqual(outcomes, [action === "PAUSE" ? "PAUSED" : "CANCELLED"]);
    assert.equal(await effectCount(job.id), 0);
    assert.equal((await read(job.id)).leaseOwner, null);
  }
}

async function verifyAccountArchiveAndCommitDeadline(fixture: WorkerFixture) {
  const account = await fixtureJob(fixture, "account-success", { scope: "ACCOUNT", workspaceId: null });
  const accountLease = await claimQueuedDataJob(prisma, { workerId: "account-worker", kinds: ["NOTIFICATION"], leaseMs: 30_000,
    partition: { ...partition(fixture), workspaceId: null } });
  assert.equal(accountLease?.jobId, account.id);
  await commitQueuedDataJob(prisma, { lease: accountLease!, effect: syntheticQueueEffect });
  const archived = await fixtureJob(fixture, "workspace-archived");
  const lease = await leaseFor(fixture);
  await prisma.examWorkspace.update({ where: { id: fixture.workspaceA.id }, data: { status: "ARCHIVED" } });
  await assert.rejects(commitQueuedDataJob(prisma, { lease, effect: syntheticQueueEffect }), /DATA_JOB_SCOPE_REVOKED/);
  assert.equal(await effectCount(archived.id), 0);
  const deadline = await fixtureJob(fixture, "commit-deadline", { scope: "ACCOUNT", workspaceId: null });
  const shortLease = await claimQueuedDataJob(prisma, { workerId: "deadline", kinds: ["NOTIFICATION"], leaseMs: 1_000, partition: partition(fixture) });
  assert.equal(shortLease?.jobId, deadline.id);
  await assert.rejects(commitQueuedDataJob(prisma, { lease: shortLease!, effect: async (tx, job) => {
    await syntheticQueueEffect(tx, job);
    await delay(1_100);
  } }), /DATA_JOB_LEASE_LOST/);
  assert.equal(await effectCount(deadline.id), 0);
  assert.equal((await read(deadline.id)).status, "RUNNING");
}

function startFixtureProcess(fixture: WorkerFixture, crash: "prepare" | "commit" | false): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./data-job-worker-runtime-child.ts", import.meta.url))], {
    stdio: ["ignore", "ignore", "ignore", "ipc"], env: {
      PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: "test",
      AREAFORGE_DATA_JOB_WORKER_ISOLATED_DB: "1", AREAFORGE_WORKER_FIXTURE_REQUESTER: fixture.owner.id,
      AREAFORGE_WORKER_FIXTURE_CRASH: crash || "0",
    },
  });
}

function waitForChild(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("worker child timed out")), 10_000);
    const message = (value: unknown) => {
      if (value && typeof value === "object" && "state" in value && value.state === expected) finish();
    };
    const exited = () => finish(new Error("worker child exited before expected state"));
    const finish = (error?: Error) => {
      clearTimeout(timeout); child.off("message", message); child.off("exit", exited); child.off("error", finish);
      if (error) reject(error); else resolve();
    };
    child.on("message", message); child.once("exit", exited); child.once("error", finish);
  });
}

async function verifyRealProcessCrash(fixture: WorkerFixture) {
  for (const point of ["prepare", "commit"] as const) await verifyCrashPoint(fixture, point);
}

async function verifyCrashPoint(fixture: WorkerFixture, point: "prepare" | "commit") {
  const job = await fixtureJob(fixture, `process-crash-${point}`);
  const crashed = startFixtureProcess(fixture, point);
  const exited = new Promise<void>((resolve) => crashed.once("exit", () => resolve()));
  try { await waitForChild(crashed, point === "prepare" ? "CLAIMED" : "EFFECT_STAGED"); } finally { crashed.kill("SIGKILL"); await exited; }
  assert.equal((await read(job.id)).status, "RUNNING");
  assert.equal(await effectCount(job.id), 0);
  await waitForFixture(async () => (await read(job.id)).leaseExpiresAt!.getTime() <= Date.now());
  await recover(fixture);
  assert.equal((await read(job.id)).status, "FAILED");
  await makeFixtureRetryDue(job.id);
  const successor = startFixtureProcess(fixture, false);
  const finished = new Promise<number | null>((resolve) => successor.once("exit", resolve));
  try { await waitForChild(successor, "SUCCEEDED"); } catch (error) { successor.kill("SIGKILL"); throw error; }
  assert.equal(await finished, 0);
  assert.equal((await read(job.id)).attempt, 2);
  assert.equal((await read(job.id)).status, "SUCCEEDED");
  assert.equal(await effectCount(job.id), 1);
}

try {
  await requireDataJobWorkerFixture();
  const migrations = await verifyDataJobWorkerMigrations();
  const cases = [verifyClaimsAndIdempotency, verifySkipLockedAndPartition, verifyRecoveryAndFencing,
    verifyDeadLetterAndReplay, verifyPauseAndCancel, verifyTransactionalRollback, verifyRevocationAndExpiry,
    verifyHeartbeatAndAbort, verifyRealProcessCrash, verifyLegacyProtocolAndScopeChecks,
    verifyRunnerControls, verifyAccountArchiveAndCommitDeadline];
  for (const verify of cases) {
    await verify(await seedDataJobWorkerFixture());
    console.log(`PASS ${verify.name}`);
  }
  console.log(JSON.stringify({ status: "pass", migrations, cases: cases.length, evidenceClass: "isolated-runtime",
    productionTouched: false, sharedDatabaseTouched: false, realArchiveCreated: false, physicalDeletionAttempted: false,
    doesNotProve: ["domain EXPORT/DELETE/RANKING/NOTIFICATION handlers", "shared or production migration", "Release or production apply", "browser acceptance"],
  }));
} finally {
  await prisma.$disconnect();
}
