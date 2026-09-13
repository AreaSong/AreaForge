import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { notificationEventKey, notificationJobFingerprint, notificationJobKey, type RankingNotificationEvent } from "../../packages/core/src/index";
import { prisma, claimQueuedDataJob, controlQueuedDataJob, deliverRankingNotificationJob, type Prisma } from "../../packages/db/src/index";
import { enqueueRankingNotification } from "../../apps/web/lib/ranking/notification-service";
import { executeDataJob } from "../workers/data-job-execution";
import { createRankingNotificationHandler } from "../workers/ranking-notification-handler";
import { makeFixtureRetryDue, requireDataJobWorkerFixture, verifyDataJobWorkerMigrations, waitForFixture } from "./data-job-worker-runtime-fixture";
import { consumeEvent, enqueueEvent, notificationCount, notificationFixture, readJob } from "./ranking-notification-runtime-fixture";
import { ownershipTargetsRemainAuthorized, unavailableRecipientsDoNotBlockSource } from "./ranking-notification-source-runtime";
import { notificationProcessCrashRecovery } from "./ranking-notification-process-runtime";

async function configuredProcess() {
  const { event } = await notificationFixture();
  const job = await enqueueEvent(event); assert.ok(job);
  const result = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../workers/data-job-worker.ts", import.meta.url)), "--once", `--workspace=${event.workspaceId}`], {
      env: { PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL, DATA_JOB_WORKER_ENABLED: "true", PLATFORM_NOTIFICATIONS_ENABLED: "true", PLATFORM_NOTIFICATION_QUEUE_ENABLED: "true" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("WORKER_FIXTURE_TIMEOUT")); }, 20_000);
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); resolve({ code, stdout }); });
  });
  assert.equal(result.code, 0); assert.match(result.stdout, /"result":"SUCCEEDED"/);
  assert.equal((await readJob(job.id)).status, "SUCCEEDED"); assert.equal(await notificationCount(event), 1);
}

async function atomicAndIdempotent() {
  const { event } = await notificationFixture();
  const baseline = await prisma.dataJob.count();
  await assert.rejects(prisma.$transaction(async tx => {
    await enqueueRankingNotification(tx, event);
    await tx.auditEvent.create({ data: { action: "SYNTHETIC_SOURCE_CHANGE", entityType: "Test", entityId: event.sourceEntityId } });
    throw new Error("SOURCE_ROLLBACK");
  }), /SOURCE_ROLLBACK/);
  assert.equal(await prisma.dataJob.count(), baseline);
  assert.equal(await prisma.auditEvent.count({ where: { action: "SYNTHETIC_SOURCE_CHANGE", entityId: event.sourceEntityId } }), 0);
  const jobs = await Promise.all(Array.from({ length: 6 }, () => enqueueEvent(event)));
  assert.ok(jobs[0]); assert.equal(new Set(jobs.map(job => job?.id)).size, 1);
  assert.equal((await consumeEvent(event)).result, "SUCCEEDED");
  const original = await prisma.userNotification.findFirstOrThrow({ where: { recipientUserId: event.recipientUserId, eventKey: notificationEventKey(event) } });
  const date = new Date();
  await prisma.userNotification.update({ where: { id: original.id }, data: { readAt: date, dismissedAt: date, revision: 3 } });
  const job = await readJob(jobs[0]!.id);
  await prisma.$transaction(tx => deliverRankingNotificationJob(tx, job));
  const repeated = await prisma.userNotification.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(repeated.revision, 3); assert.equal(repeated.dismissedAt?.getTime(), date.getTime());
  assert.equal(await notificationCount(event), 1);
  assert.equal(JSON.stringify(job.resultJson).includes("不得进入通知"), false);
}

async function allEventKinds() {
  for (const kind of ["RANKING_CHALLENGE_STATUS", "RANKING_PARTICIPANT_REMOVED", "RANKING_PARTICIPANT_STATUS", "RANKING_OWNERSHIP_TRANSFERRED", "RANKING_APPEAL_SUBMITTED", "RANKING_APPEAL_STATUS", "RANKING_APPEAL_WITHDRAWN"] as const) {
    const fixture = await notificationFixture();
    const event: RankingNotificationEvent = { ...fixture.event, kind };
    if (kind === "RANKING_CHALLENGE_STATUS" || kind === "RANKING_OWNERSHIP_TRANSFERRED") {
      event.sourceEntityType = "PRIVATE_CHALLENGE"; event.sourceEntityId = fixture.challenge.id;
    }
    if (kind === "RANKING_PARTICIPANT_REMOVED") await prisma.privateChallengeParticipant.update({ where: { id: fixture.participant.id }, data: { status: "REMOVED" } });
    if (kind === "RANKING_PARTICIPANT_STATUS") {
      event.actorUserId = fixture.other.id; event.recipientUserId = fixture.owner.id;
      await prisma.privateChallengeParticipant.update({ where: { id: fixture.participant.id }, data: { status: "LEFT" } });
    }
    if (kind === "RANKING_OWNERSHIP_TRANSFERRED") {
      await prisma.privateChallengeParticipant.update({ where: { id: fixture.participant.id }, data: { status: "ACTIVE" } });
      await prisma.privateChallenge.update({ where: { id: fixture.challenge.id }, data: { ownerUserId: fixture.other.id } });
      await prisma.auditEvent.create({ data: { actorId: fixture.owner.id, entityType: "PrivateChallenge", entityId: fixture.challenge.id, action: "RANKING_CHALLENGE_OWNERSHIP_TRANSFERRED", metadata: { revision: 1, previousOwnerUserId: fixture.owner.id, nextOwnerUserId: fixture.other.id } } });
    }
    if (kind.startsWith("RANKING_APPEAL")) {
      const status = kind === "RANKING_APPEAL_STATUS" ? "UNDER_REVIEW" : kind === "RANKING_APPEAL_WITHDRAWN" ? "WITHDRAWN" : "OPEN";
      const appeal = await prisma.rankingAppeal.create({ data: { challengeId: fixture.challenge.id, participantId: fixture.participant.id, submittedByUserId: fixture.other.id, reviewedByUserId: status === "UNDER_REVIEW" ? fixture.owner.id : null, reviewedAt: status === "UNDER_REVIEW" ? new Date() : null, status, reason: "不应进入通知的合成申诉正文", projectionFingerprint: "a".repeat(64) } });
      event.sourceEntityType = "RANKING_APPEAL"; event.sourceEntityId = appeal.id;
      if (kind !== "RANKING_APPEAL_STATUS") { event.actorUserId = fixture.other.id; event.recipientUserId = fixture.owner.id; }
    }
    await enqueueEvent(event);
    assert.equal((await consumeEvent(event)).result, "SUCCEEDED", kind);
    assert.equal(await notificationCount(event), 1);
  }
}

async function sourceAndBindingRejections() {
  const { event, workspaceB, owner } = await notificationFixture();
  for (const bad of [{ ...event, workspaceId: workspaceB.id }, { ...event, recipientUserId: owner.id, actorUserId: event.recipientUserId }, { ...event, eventVersion: 999 }, { ...event, sourceEntityId: "does-not-exist" }]) await assert.rejects(enqueueEvent(bad));
  const queued = await enqueueEvent(event); assert.ok(queued);
  const row = await readJob(queued.id);
  const json = row.resultJson as unknown as Record<string, unknown>;
  for (const data of [
    { ...row, workspaceId: workspaceB.id }, { ...row, requestedByUserId: event.recipientUserId },
    { ...row, requestFingerprint: "sha256:" + "b".repeat(64) }, { ...row, idempotencyKey: "forged" },
    { ...row, resultJson: { ...json, extra: "private" } as Prisma.JsonObject },
  ]) await assert.rejects(prisma.$transaction(tx => deliverRankingNotificationJob(tx, data)));
  assert.equal(await notificationCount(event), 0);
  const result = await consumeEvent(event); assert.equal(result.result, "SUCCEEDED");
}

async function revokedAndRejoined() {
  for (const mutation of ["member", "account", "workspace"] as const) {
    const { event } = await notificationFixture();
    const job = await enqueueEvent(event); assert.ok(job);
    if (mutation === "member") {
      await prisma.workspaceMembership.update({ where: { workspaceId_userId: { workspaceId: event.workspaceId, userId: event.recipientUserId } }, data: { status: "REMOVED", revision: { increment: 1 } } });
      await prisma.workspaceMembership.update({ where: { workspaceId_userId: { workspaceId: event.workspaceId, userId: event.recipientUserId } }, data: { status: "ACTIVE", revision: { increment: 1 } } });
    } else if (mutation === "account") {
      await prisma.user.update({ where: { id: event.recipientUserId }, data: { status: "SUSPENDED", authRevision: { increment: 1 } } });
      await prisma.user.update({ where: { id: event.recipientUserId }, data: { status: "ACTIVE" } });
    } else {
      await prisma.examWorkspace.update({ where: { id: event.workspaceId }, data: { status: "ARCHIVED", revision: { increment: 1 } } });
      await prisma.examWorkspace.update({ where: { id: event.workspaceId }, data: { status: "ACTIVE", revision: { increment: 1 } } });
    }
    const result = await consumeEvent(event);
    assert.equal(result.result, "FAILED"); assert.equal(result.job.errorCode, "USER_NOTIFICATION_AUTHORIZATION_REVOKED");
    assert.ok(result.job.deadLetteredAt); assert.equal(await notificationCount(event), 0);
  }
}

async function runtimeSwitchesAndDirectMode() {
  const fixture = await notificationFixture();
  const { event } = fixture;
  const before = await prisma.dataJob.count();
  process.env.PLATFORM_NOTIFICATIONS_ENABLED = "false";
  try { assert.equal(await enqueueEvent(event), null); } finally { process.env.PLATFORM_NOTIFICATIONS_ENABLED = "true"; }
  process.env.PLATFORM_NOTIFICATION_QUEUE_ENABLED = "false";
  try {
    await assert.rejects(enqueueEvent({ ...event, sourceEntityId: "absent" }));
    await enqueueEvent(event); assert.equal(await notificationCount(event), 1); assert.equal(await prisma.dataJob.count(), before);
  } finally { process.env.PLATFORM_NOTIFICATION_QUEUE_ENABLED = "true"; }
  const second = await notificationFixture(); await enqueueEvent(second.event);
  const lease = await claimQueuedDataJob(prisma, { workerId: "switch-runtime", kinds: ["NOTIFICATION"], leaseMs: 30_000, partition: { requestedByUserId: second.owner.id } }); assert.ok(lease);
  const result = await executeDataJob({ client: prisma, lease, leaseMs: 30_000, signal: new AbortController().signal,
    handler: { kind: "NOTIFICATION", prepare: async context => {
      const effect = await createRankingNotificationHandler().prepare(context);
      process.env.PLATFORM_NOTIFICATION_QUEUE_ENABLED = "false";
      return effect;
    } },
  }).finally(() => { process.env.PLATFORM_NOTIFICATION_QUEUE_ENABLED = "true"; });
  assert.equal(result, "FAILED"); assert.equal((await readJob(lease.jobId)).retryable, true);
  assert.equal(await notificationCount(second.event), 0);
  await makeFixtureRetryDue(lease.jobId); assert.equal((await consumeEvent(second.event)).result, "SUCCEEDED");
}

async function scopeLockCompetition() {
  const { event } = await notificationFixture(); const job = await enqueueEvent(event); assert.ok(job);
  let acquired!: () => void; let release!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const transaction = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "WorkspaceMembership" WHERE "workspaceId" = ${event.workspaceId} AND "userId" = ${event.recipientUserId} FOR UPDATE`;
    acquired(); await held;
    await tx.workspaceMembership.update({ where: { workspaceId_userId: { workspaceId: event.workspaceId, userId: event.recipientUserId } }, data: { status: "REMOVED", revision: { increment: 1 } } });
  });
  try {
    await ready;
    const result = await consumeEvent(event);
    assert.equal(result.result, "FAILED"); assert.equal(result.job.errorCode, "USER_NOTIFICATION_SCOPE_BUSY"); assert.equal(result.job.retryable, true);
  } finally { release(); await transaction; }
  await makeFixtureRetryDue(job.id); const rejected = await consumeEvent(event);
  assert.equal(rejected.job.errorCode, "USER_NOTIFICATION_AUTHORIZATION_REVOKED"); assert.equal(await notificationCount(event), 0);
}

async function conflictingEventAndReplay() {
  const { event, workspaceB } = await notificationFixture(); const job = await enqueueEvent(event); assert.ok(job);
  await prisma.userNotification.create({ data: { recipientUserId: event.recipientUserId, workspaceId: workspaceB.id, workspaceLabel: "conflict", kind: event.kind, sourceEntityType: event.sourceEntityType, sourceEntityId: event.sourceEntityId, eventKey: notificationEventKey(event) } });
  const result = await consumeEvent(event);
  assert.equal(result.result, "FAILED"); assert.equal(result.job.errorCode, "USER_NOTIFICATION_EVENT_KEY_CONFLICT"); assert.ok(result.job.deadLetteredAt);
  // 死信重放不能改变任务绑定；冲突仍存在时不会覆盖已有通知。
  await controlQueuedDataJob(prisma, { jobId: job.id, actorId: event.actorUserId, expectedRevision: result.job.updatedAt.getTime(), action: "REPLAY" });
  assert.equal((await consumeEvent(event)).job.errorCode, "USER_NOTIFICATION_EVENT_KEY_CONFLICT");
  assert.equal(await notificationCount(event), 1);
}

const envKeys = ["PLATFORM_NOTIFICATIONS_ENABLED", "PLATFORM_NOTIFICATION_QUEUE_ENABLED"] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
try {
  assert.equal(process.env.AREAFORGE_RANKING_NOTIFICATION_ISOLATED_DB, "1");
  await requireDataJobWorkerFixture(); const migrations = await verifyDataJobWorkerMigrations();
  for (const key of envKeys) process.env[key] = "true";
  const cases = [configuredProcess, atomicAndIdempotent, allEventKinds, sourceAndBindingRejections, revokedAndRejoined, runtimeSwitchesAndDirectMode, scopeLockCompetition, conflictingEventAndReplay, unavailableRecipientsDoNotBlockSource, ownershipTargetsRemainAuthorized, notificationProcessCrashRecovery];
  for (const verify of cases) { await verify(); console.log(`PASS ${verify.name}`); }
  console.log(JSON.stringify({ result: "PASS", migrations, cases: cases.length, productionTouched: false, sharedDatabaseTouched: false, externalDelivery: false }));
} finally {
  for (const key of envKeys) { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; }
  await prisma.$disconnect();
}
