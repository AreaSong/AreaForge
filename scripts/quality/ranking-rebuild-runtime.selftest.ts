import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSafeRankingProjection, controlRankingRebuild, enqueueRankingRebuild, claimQueuedDataJob, commitQueuedDataJob,
  prisma, type PrismaClient } from "../../packages/db/src/index";
import { loadRankingFixture, rankingFixtureEnvironment, assertRankingFixtureContainer, verifyRankingFixtureLedger, type RankingRebuildFixture } from "./ranking-rebuild-fixture";
import { createRankingCase, requestRankingCase, consumeRankingCase, rankingSideEffects, rankingFixtureClient, type RankingCase } from "./ranking-rebuild-runtime-data";
import { rankingProcessCrashRecovery, rankingRunningControl, rankingRunningDisable, rankingLeaseExpiresDuringCommit } from "./ranking-rebuild-process-runtime";
import { rankingRealMembershipChanges, rankingRealAccountChange, rankingConsentHistory, rankingExportRedaction } from "./ranking-rebuild-lifecycle-runtime";
import { rankingDeletionLifecycle, rankingFrozenRequester } from "./ranking-rebuild-delete-runtime";
import { rankingConcurrentRequests, rankingDeleteFenceConflict, rankingMembershipLockConflict, rankingPreparedSourceDrift,
  rankingBudgetRefusal, rankingConfiguredCli, rankingOrderingAndEmptyPublication } from "./ranking-rebuild-race-runtime";
import { rankingRebuildSourceFingerprint } from "./ranking-rebuild-source";

const passed: string[] = []; let current = "fixture";
const selected = process.argv[3]?.startsWith("--case=") ? process.argv[3].slice(7) : undefined;
async function check(name: string, run: () => Promise<void>) {
  if (selected && name !== selected && name !== "canonical-53-migration-ledger") return;
  current = name; await run(); passed.push(name); console.log(`PASS ${name}`);
}

async function main() {
  const fixture = loadRankingFixture(process.argv[2] ?? ""); assertRankingFixtureContainer(fixture);
  const env = rankingFixtureEnvironment(fixture); Object.assign(process.env, env);
  const sourceFingerprint = rankingRebuildSourceFingerprint();
  const client = rankingFixtureClient(env.DATABASE_URL!);
  try {
    await check("canonical-53-migration-ledger", async () => { assert.equal(await verifyRankingFixtureLedger(client, fixture), 53); });
    await basic(client, fixture);
    await idempotency(client, fixture);
    await sourceChange(client, fixture);
    await generations(client, fixture);
    await controls(client, fixture);
    await permissionHistory(client, fixture);
    await gates(client, fixture, env);
    await check("prepared-and-uncommitted-publication-SIGKILL", () => rankingProcessCrashRecovery(client, fixture));
    await check("running-pause-cancel-acknowledgement", () => rankingRunningControl(client, fixture));
    await check("worker-switch-disabled-before-commit", () => rankingRunningDisable(client, fixture));
    await check("real-membership-role-and-ownership-changes", () => rankingRealMembershipChanges(client, fixture));
    await check("real-operator-account-suspend-and-restore", () => rankingRealAccountChange(client, fixture));
    await check("real-opt-out-reinvite-and-rejoin", () => rankingConsentHistory(client, fixture));
    await check("ranking-job-export-redaction", () => rankingExportRedaction(client, fixture));
    await check("real-freeze-cancel-and-database-erasure", () => rankingDeletionLifecycle(client, fixture));
    await check("frozen-requester-jobs-are-not-consumed", () => rankingFrozenRequester(client, fixture));
    await check("concurrent-idempotency-and-single-claim", () => rankingConcurrentRequests(client, fixture));
    await check("delete-fence-conflict-is-bounded", () => rankingDeleteFenceConflict(client, fixture));
    await check("membership-workspace-reverse-lock-conflict", () => rankingMembershipLockConflict(client, fixture));
    await check("source-changed-after-preparation", () => rankingPreparedSourceDrift(client, fixture));
    await check("over-budget-rejects-without-partial-ranking", () => rankingBudgetRefusal(client, fixture));
    await check("configured-standalone-worker-cli", () => rankingConfiguredCli(client, fixture));
    await check("score-ordering-and-empty-publication-proof", () => rankingOrderingAndEmptyPublication(client, fixture));
    await check("lease-expires-after-projection-write", () => rankingLeaseExpiresDuringCommit(client, fixture));
    await check("session-bound-admission-and-control", async () => {
      const data = await createRankingCase(client, fixture, "session-bound");
      await assert.rejects(enqueueRankingRebuild(client, { actorId: data.owner.id, sessionId: data.stranger.sessionId,
        challengeId: data.challenge.id, expectedRevision: 1, idempotencyKey: randomUUID() }), /SESSION_REVOKED/);
      const job = await requestRankingCase(client, data);
      await client.authSession.update({ where: { id: data.owner.sessionId }, data: { revokedAt: new Date() } });
      await assert.rejects(controlRankingRebuild(client, { actorId: data.owner.id, sessionId: data.owner.sessionId,
        challengeId: data.challenge.id, jobId: job.id, expectedRevision: job.revision, action: "CANCEL" }), /SESSION_REVOKED/);
      assert.deepEqual(await consumeRankingCase(client, data), ["SUCCEEDED"]);
    });
    assert.equal(rankingRebuildSourceFingerprint(), sourceFingerprint, "runtime source changed while checking");
    if (selected) { assert.equal(passed.length, 2, "selected runtime case must exist"); return; }
    await mkdir(path.resolve("output/ranking-rebuild"), { recursive: true });
    await writeFile(path.resolve("output/ranking-rebuild/runtime-evidence.json"), JSON.stringify({ schemaVersion: 1,
      scope: "RANKING local fixture runtime", checkedAt: new Date().toISOString(), fixtureId: fixture.scopeId,
      migrations: 53, sourceFingerprint, passed, productionTouched: false }, null, 2) + "\n");
    console.log(`PASS RANKING runtime ${passed.length} groups; local fixture only`);
  } finally { await client.$disconnect(); await prisma.$disconnect(); }
}

async function basic(client: PrismaClient, fixture: RankingRebuildFixture) {
  await check("atomic-ranking-private-fields-and-readonly-source", async () => {
    const data = await createRankingCase(client, fixture, "basic"); const before = await rankingSideEffects(client, data);
    assert.equal((await getSafeRankingProjection(client, data.owner.id, data.challenge.id)).stale, true);
    const job = await requestRankingCase(client, data); assert.equal(job.status, "QUEUED");
    assert.deepEqual(await consumeRankingCase(client, data), ["SUCCEEDED"]);
    const projection = await getSafeRankingProjection(client, data.member.id, data.challenge.id);
    assert.equal(projection.stale, false); assert.equal(projection.entries.length, 2);
    const concurrent = await Promise.all([getSafeRankingProjection(client, data.owner.id, data.challenge.id),
      getSafeRankingProjection(client, data.member.id, data.challenge.id)]);
    assert.ok(concurrent.every(view => !view.stale && view.entries.length === 2));
    const participants = await client.privateChallengeParticipant.findMany({ where: { challengeId: data.challenge.id } });
    const member = participants.find(row => row.userId === data.member.id)!;
    assert.deepEqual(Object.keys(projection.entries.find(row => row.participantId === member.id)!.fields), ["score"]);
    const after = await rankingSideEffects(client, data); assert.deepEqual(after.sessions, before.sessions); assert.equal(after.effects, 1);
    const encoded = JSON.stringify({ projection, job });
    for (const forbidden of ["authorization", "sourceFingerprint", "private-session-body-sentinel", "private-output-sentinel", fixture.password]) assert.equal(encoded.includes(forbidden), false);
    assert.deepEqual(await consumeRankingCase(client, data), []);
    await assert.rejects(getSafeRankingProjection(client, data.stranger.id, data.challenge.id), /NOT_FOUND/);
  });
}

async function idempotency(client: PrismaClient, fixture: RankingRebuildFixture) {
  await check("idempotency-conflict-and-owner-scope", async () => {
    const data = await createRankingCase(client, fixture, "idempotency"); const key = randomUUID();
    const first = await requestRankingCase(client, data, key); const again = await requestRankingCase(client, data, key);
    assert.equal(first.id, again.id);
    await assert.rejects(enqueueRankingRebuild(client, { actorId: data.member.id, sessionId: data.member.sessionId,
      challengeId: data.challenge.id, expectedRevision: 1, idempotencyKey: randomUUID() }), /NOT_FOUND/);
    await assert.rejects(enqueueRankingRebuild(client, { actorId: data.owner.id, sessionId: data.owner.sessionId,
      challengeId: data.challenge.id, expectedRevision: 2, idempotencyKey: key }), /IDEMPOTENCY_CONFLICT/);
    assert.equal(await client.dataJob.count({ where: { workspaceId: data.workspace.id } }), 1);
  });
}

async function sourceChange(client: PrismaClient, fixture: RankingRebuildFixture) {
  await check("source-time-and-aba-version-fencing", async () => {
    for (const column of ["startedAt", "effectiveMinutes"] as const) {
      const data = await createRankingCase(client, fixture, `source-${column}`); const job = await requestRankingCase(client, data);
      const source = data.sessions[0]!;
      await client.studySession.update({ where: { id: source.id }, data: column === "startedAt"
        ? { startedAt: new Date(source.startedAt.getTime() - 60_000) } : { effectiveMinutes: source.effectiveMinutes - 1 } });
      await client.studySession.update({ where: { id: source.id }, data: { [column]: source[column] } });
      assert.deepEqual(await consumeRankingCase(client, data), ["FAILED"]);
      assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).errorCode, "RANKING_REBUILD_SNAPSHOT_CHANGED");
      assert.equal((await rankingSideEffects(client, data)).effects, 0);
    }
  });
}

async function generations(client: PrismaClient, fixture: RankingRebuildFixture) {
  await check("new-generation-does-not-revive-older-request", async () => {
    const data = await createRankingCase(client, fixture, "generation"); const old = await requestRankingCase(client, data);
    const latest = await requestRankingCase(client, data);
    await controlRankingRebuild(client, { actorId: data.owner.id, sessionId: data.owner.sessionId, challengeId: data.challenge.id,
      jobId: latest.id, expectedRevision: latest.revision, action: "CANCEL" });
    assert.deepEqual(await consumeRankingCase(client, data), ["FAILED"]);
    assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: old.id } })).errorCode, "RANKING_REBUILD_SUPERSEDED");
    assert.equal((await rankingSideEffects(client, data)).effects, 0);
  });
}

async function controls(client: PrismaClient, fixture: RankingRebuildFixture) {
  await check("pause-resume-cancel-and-old-lease", async () => {
    const data = await createRankingCase(client, fixture, "controls"); let job = await requestRankingCase(client, data);
    const control = (action: "PAUSE" | "RESUME" | "CANCEL") => controlRankingRebuild(client, { actorId: data.owner.id, sessionId: data.owner.sessionId,
      challengeId: data.challenge.id, jobId: job.id, expectedRevision: job.revision, action });
    job = await control("PAUSE"); assert.equal(job.status, "PAUSED"); assert.deepEqual(await consumeRankingCase(client, data), []);
    job = await control("RESUME"); assert.equal(job.status, "QUEUED");
    const lease = await claimQueuedDataJob(client, { workerId: "old-ranking-worker", kinds: ["RANKING_REBUILD"], leaseMs: 30_000, partition: { workspaceId: data.workspace.id } });
    assert.ok(lease); await client.dataJob.update({ where: { id: job.id }, data: { leaseVersion: { increment: 1 } } });
    await assert.rejects(commitQueuedDataJob(client, { lease, effect: async () => { throw new Error("must-not-run"); } }), /LEASE_LOST/);
    const row = await client.dataJob.findUniqueOrThrow({ where: { id: job.id } }); job = { ...job, revision: row.updatedAt.getTime() };
    job = await control("CANCEL"); assert.equal(job.status, "CANCEL_REQUESTED");
  });
}

async function permissionHistory(client: PrismaClient, fixture: RankingRebuildFixture) {
  await check("account-and-membership-revocation-history", async () => {
    for (const kind of ["account", "membership"] as const) {
      const data = await createRankingCase(client, fixture, kind); const job = await requestRankingCase(client, data);
      if (kind === "account") {
        await client.user.update({ where: { id: data.member.id }, data: { status: "SUSPENDED", authRevision: { increment: 1 } } });
        await client.user.update({ where: { id: data.member.id }, data: { status: "ACTIVE", authRevision: { increment: 1 } } });
      } else {
        const where = { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } };
        await client.workspaceMembership.update({ where, data: { status: "REMOVED", revision: { increment: 1 } } });
        await client.workspaceMembership.update({ where, data: { status: "ACTIVE", revision: { increment: 1 } } });
      }
      assert.deepEqual(await consumeRankingCase(client, data), ["FAILED"]);
      assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).errorCode, "RANKING_REBUILD_SNAPSHOT_CHANGED");
      assert.equal((await rankingSideEffects(client, data)).effects, 0);
    }
  });
}

async function gates(client: PrismaClient, fixture: RankingRebuildFixture, env: NodeJS.ProcessEnv) {
  await check("queue-gates-fail-closed", async () => {
    const data = await createRankingCase(client, fixture, "gate");
    await assert.rejects(enqueueRankingRebuild(client, { actorId: data.owner.id, sessionId: data.owner.sessionId,
      challengeId: data.challenge.id, expectedRevision: 1, idempotencyKey: randomUUID() }, { ...env, DATA_JOB_WORKER_ENABLED: "false" }), /DISABLED/);
    const job = await requestRankingCase(client, data);
    assert.deepEqual(await consumeRankingCase(client, data, { ...env, DATA_JOB_WORKER_ENABLED: "false" }), ["FAILED"]);
    assert.equal((await client.dataJob.findUniqueOrThrow({ where: { id: job.id } })).errorCode, "RANKING_REBUILD_DISABLED");
  });
}

main().catch(error => {
  const row = error as { name?: string; code?: string; meta?: { modelName?: string; driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } };
  const cause = row.meta?.driverAdapterError?.cause;
  console.error(JSON.stringify({ event: "RANKING_RUNTIME_FAILED", case: current, name: row.name,
    code: /^[A-Z0-9_]{1,80}$/.test(row.code ?? "") ? row.code : undefined,
    databaseCode: /^[A-Z0-9]{5}$/.test(cause?.originalCode ?? "") ? cause?.originalCode : undefined,
    guard: cause?.originalMessage?.match(/^DATA_DELETE_[A-Z_]+/)?.[0], model: /^[A-Za-z]{1,80}$/.test(row.meta?.modelName ?? "") ? row.meta?.modelName : undefined }));
  process.exitCode = 1;
});
