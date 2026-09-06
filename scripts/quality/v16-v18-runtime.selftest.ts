import assert from "node:assert/strict";
import { prisma } from "../../packages/db/src/index";
import {
  claimDataLifecycleJob,
  completeDataLifecycleJob,
  heartbeatDataLifecycleJob,
  requestDataLifecycleJob,
} from "../../apps/web/lib/system/data-lifecycle-service";
import {
  approveControlledOperationRequest,
  claimControlledOperationRequest,
  completeControlledOperationRequest,
  confirmControlledOperationRequest,
  createControlledOperationRequest,
} from "../../apps/web/lib/system/controlled-operation-request-service";
import { updateRankingPreference } from "../../apps/web/lib/ranking/preference-service";
import {
  createPrivateChallenge,
  invitePrivateChallengeParticipant,
  transitionPrivateChallenge,
  transitionPrivateChallengeParticipantForActor,
} from "../../apps/web/lib/ranking/challenge-service";
import { rebuildChallengeProjection } from "../../apps/web/lib/ranking/projection-service";
import { resetRbacRuntimeFixture, seedRbacRuntimeFixture } from "./v15-rbac-runtime-fixture";

const HASH = `sha256:${"a".repeat(64)}`;

try {
  assert.equal(process.env.AREAFORGE_AB_CANDIDATE_ISOLATED_DB, "1");
  const database = (await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`)[0]?.current_database ?? "";
  assert.match(database, /ab_candidate|v15rbac_ab/i);
  process.env.AUTH_MULTI_USER_ENABLED = "true";
  process.env.AUTH_RBAC_ENABLED = "true";
  process.env.DATA_LIFECYCLE_ENABLED = "true";
  process.env.RANKING_ENABLED = "true";
  process.env.AUTH_SESSION_SECRET = process.env.AUTH_SESSION_SECRET ?? "ab-candidate-session-secret-20260906";
  process.env.AUTH_ACTION_TOKEN_SECRET = process.env.AUTH_ACTION_TOKEN_SECRET ?? "ab-candidate-action-secret-20260906";

  await resetRbacRuntimeFixture();
  const fixture = await seedRbacRuntimeFixture("ab-candidate");
  process.env.AUTH_ADMIN_EMAIL = fixture.users.operator.email;
  const now = new Date("2026-09-06T08:00:00.000Z");

  const exportJob = await requestDataLifecycleJob(fixture.users.owner.actor, {
    kind: "EXPORT",
    scope: "WORKSPACE",
    workspaceId: fixture.workspaceIds.primary,
    idempotencyKey: "ab-export-job-20260906",
  });
  assert.equal(exportJob.status, "QUEUED");
  const lease = await claimDataLifecycleJob({
    jobId: exportJob.id,
    workerId: "ab-worker",
    leaseExpiresAt: new Date("2026-09-06T08:05:00.000Z"),
    now,
  });
  const heartbeat = await heartbeatDataLifecycleJob({
    jobId: exportJob.id,
    workerId: "ab-worker",
    expectedRevision: lease.job.revision,
    leaseExpiresAt: new Date("2026-09-06T08:06:00.000Z"),
    progress: 0.5,
    now: new Date("2026-09-06T08:01:00.000Z"),
  });
  const completed = await completeDataLifecycleJob({
    jobId: exportJob.id,
    workerId: "ab-worker",
    expectedRevision: heartbeat.revision,
    outcome: "SUCCEEDED",
    now: new Date("2026-09-06T08:02:00.000Z"),
  });
  assert.equal(completed.status, "SUCCEEDED");
  assert.equal(completed.preview && "packageStatus" in completed.preview ? completed.preview.packageStatus : null, "NOT_CREATED");

  const operation = await createControlledOperationRequest(fixture.users.operator.actor, {
    operation: { operation: "DIAGNOSTIC_HEALTH", includeCapacity: false },
    expectedBeforeHash: HASH,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    requestedReason: "隔离候选诊断",
  }, { now });
  const confirmed = await confirmControlledOperationRequest(fixture.users.operator.actor, operation.id, {
    expectedRevision: operation.revision,
    requestHash: operation.requestHash,
    nonce: operation.nonce,
  });
  const opLease = await claimControlledOperationRequest({
    requestId: operation.id,
    workerId: "ab-root-agent",
    expectedBeforeHash: HASH,
    leaseExpiresAt: new Date("2026-09-06T08:05:00.000Z"),
    now: new Date("2026-09-06T08:01:00.000Z"),
  });
  const operationDone = await completeControlledOperationRequest({
    requestId: operation.id,
    workerId: "ab-root-agent",
    leaseToken: opLease.leaseToken,
    outcome: "SUCCEEDED",
    resultCode: "DIAGNOSTIC_OK",
    now: new Date("2026-09-06T08:02:00.000Z"),
  });
  assert.equal(confirmed.status, "QUEUED");
  assert.equal(operationDone.status, "SUCCEEDED");

  await updateRankingPreference(fixture.users.owner.actor, fixture.workspaceIds.primary, {
    enabled: true,
    timezone: "Asia/Shanghai",
    authorizedFields: ["score"],
  });
  await updateRankingPreference(fixture.users.member.actor, fixture.workspaceIds.primary, {
    enabled: true,
    timezone: "Asia/Shanghai",
    authorizedFields: ["score"],
  });
  const challenge = await createPrivateChallenge(fixture.users.owner.actor, {
    workspaceId: fixture.workspaceIds.primary,
    name: "隔离候选挑战",
    description: null,
    timezone: "Asia/Shanghai",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    targetEffectiveMinutesPerDay: 30,
    publishedFields: ["score"],
  });
  const invited = await invitePrivateChallengeParticipant(fixture.users.owner.actor, challenge.id, {
    userId: fixture.users.member.userId,
    nickname: "成员",
    authorizedFields: ["score"],
  });
  await transitionPrivateChallengeParticipantForActor(fixture.users.member.actor, challenge.id, "join");
  const activeChallenge = await transitionPrivateChallenge(fixture.users.owner.actor, challenge.id, "start", challenge.revision);
  const projection = await rebuildChallengeProjection(fixture.users.owner.actor, challenge.id, activeChallenge.revision);
  assert.equal(invited.status, "INVITED");
  assert.equal(projection.stale, false);
  assert.equal(projection.entries.length, 2);

  console.log(JSON.stringify({
    schemaVersion: "v16-v18-runtime-selftest-v1",
    status: "pass",
    database,
    checks: {
      dataJobWorker: completed.status,
      exportArchiveStatus: "NOT_CREATED",
      controlledOperation: operationDone.status,
      rankingProjectionEntries: projection.entries.length,
      rankingProjectionStale: projection.stale,
    },
    safetyFacts: {
      isolatedDatabaseRequired: true,
      productionWriteAttempted: false,
      physicalDeleteAttempted: false,
      archiveFileWritten: false,
      serverCommandAttempted: false,
      secretsOperationAttempted: false,
    },
  }, null, 2));
  console.log("PASS v1.6/v1.7/v1.8 isolated runtime selftest");
} finally {
  await prisma.$disconnect();
}
