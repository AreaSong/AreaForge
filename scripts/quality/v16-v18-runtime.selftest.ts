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
  listRankingAppeals,
  submitRankingAppeal,
  transitionRankingAppeal,
} from "../../apps/web/lib/ranking/appeal-service";
import {
  listUserNotifications,
  updateUserNotification,
} from "../../apps/web/lib/notifications/inbox-service";
import {
  createPrivateChallenge,
  invitePrivateChallengeParticipant,
  transitionPrivateChallenge,
  transitionPrivateChallengeParticipantForActor,
} from "../../apps/web/lib/ranking/challenge-service";
import { enqueueRankingNotification } from "../../apps/web/lib/ranking/notification-service";
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
  process.env.RANKING_PROJECTION_ENABLED = "true";
  process.env.PLATFORM_NOTIFICATIONS_ENABLED = "true";
  process.env.AUTH_SESSION_SECRET = process.env.AUTH_SESSION_SECRET ?? "ab-candidate-session-secret-20260906";
  process.env.AUTH_ACTION_TOKEN_SECRET = process.env.AUTH_ACTION_TOKEN_SECRET ?? "ab-candidate-action-secret-20260906";

  await resetRbacRuntimeFixture();
  const fixture = await seedRbacRuntimeFixture("ab-candidate");
  process.env.AUTH_ADMIN_EMAIL = fixture.users.operator.email;
  const now = new Date();
  const afterMinutes = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  const secondaryExportJob = await requestDataLifecycleJob(fixture.users.owner.actor, {
    kind: "EXPORT",
    scope: "WORKSPACE",
    workspaceId: fixture.workspaceIds.secondary,
    idempotencyKey: "ab-export-secondary-20260906",
  });
  const exportJob = await requestDataLifecycleJob(fixture.users.owner.actor, {
    kind: "EXPORT",
    scope: "WORKSPACE",
    workspaceId: fixture.workspaceIds.primary,
    idempotencyKey: "ab-export-job-20260906",
  });
  assert.equal(exportJob.status, "QUEUED");
  assert.equal(exportJob.preview && "entries" in exportJob.preview
    ? exportJob.preview.entries.some((entry) => entry.kind === "dataJob" && entry.id === secondaryExportJob.id)
    : true, false);
  const lease = await claimDataLifecycleJob({
    jobId: exportJob.id,
    workerId: "ab-worker",
    leaseExpiresAt: afterMinutes(5),
    now,
  });
  const heartbeat = await heartbeatDataLifecycleJob({
    jobId: exportJob.id,
    workerId: "ab-worker",
    expectedRevision: lease.job.revision,
    leaseExpiresAt: afterMinutes(6),
    progress: 0.5,
    now: afterMinutes(1),
  });
  const completed = await completeDataLifecycleJob({
    jobId: exportJob.id,
    workerId: "ab-worker",
    expectedRevision: heartbeat.revision,
    outcome: "SUCCEEDED",
    now: afterMinutes(2),
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
    leaseExpiresAt: afterMinutes(5),
    now: afterMinutes(1),
  });
  const operationDone = await completeControlledOperationRequest({
    requestId: operation.id,
    workerId: "ab-root-agent",
    leaseToken: opLease.leaseToken,
    outcome: "SUCCEEDED",
    resultCode: "DIAGNOSTIC_OK",
    now: afterMinutes(2),
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
  const appealReason = "隔离候选排名需要复核";
  const appeal = await submitRankingAppeal(fixture.users.member.actor, challenge.id, {
    participantId: invited.id,
    reason: appealReason,
  });
  assert.equal(appeal.status, "OPEN");
  await assert.rejects(
    submitRankingAppeal(fixture.users.member.actor, challenge.id, {
      participantId: invited.id,
      reason: "重复未决申诉应被拒绝",
    }),
    /RANKING_APPEAL_ALREADY_OPEN/,
  );
  await assert.rejects(
    transitionRankingAppeal(fixture.users.member.actor, challenge.id, appeal.appealId, {
      action: "review",
      expectedRevision: appeal.revision,
    }),
    /RANKING_APPEAL_NOT_FOUND/,
  );
  const reviewed = await transitionRankingAppeal(fixture.users.owner.actor, challenge.id, appeal.appealId, {
    action: "review",
    expectedRevision: appeal.revision,
  });
  await assert.rejects(
    transitionRankingAppeal(fixture.users.owner.actor, challenge.id, appeal.appealId, {
      action: "accept",
      expectedRevision: appeal.revision,
    }),
    /RANKING_APPEAL_CONFLICT/,
  );
  const accepted = await transitionRankingAppeal(fixture.users.owner.actor, challenge.id, appeal.appealId, {
    action: "accept",
    expectedRevision: reviewed.revision,
  });
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal((await listRankingAppeals(fixture.users.member.actor.id, challenge.id)).length, 1);
  const appealToWithdraw = await submitRankingAppeal(fixture.users.member.actor, challenge.id, {
    participantId: invited.id,
    reason: "该申诉已自行核对，无需继续处理",
  });
  const withdrawnAppeal = await transitionRankingAppeal(fixture.users.member.actor, challenge.id, appealToWithdraw.appealId, {
    action: "withdraw",
    expectedRevision: appealToWithdraw.revision,
  });
  assert.equal(withdrawnAppeal.status, "WITHDRAWN");
  const appealAuditRows = await prisma.auditEvent.findMany({
    where: { entityType: "RankingAppeal", entityId: appeal.appealId },
    select: { metadata: true },
  });
  assert.ok(appealAuditRows.length >= 3);
  assert.equal(JSON.stringify(appealAuditRows).includes(appealReason), false);
  const [ownerNotifications, memberNotifications] = await Promise.all([
    listUserNotifications(fixture.users.owner.userId, "all"),
    listUserNotifications(fixture.users.member.userId, "all"),
  ]);
  assert.ok(ownerNotifications.some((item) => item.kind === "RANKING_APPEAL_SUBMITTED"));
  assert.ok(ownerNotifications.some((item) => item.kind === "RANKING_PARTICIPANT_STATUS"));
  assert.ok(ownerNotifications.some((item) => item.kind === "RANKING_APPEAL_WITHDRAWN"));
  assert.ok(memberNotifications.some((item) => item.kind === "RANKING_INVITATION"));
  assert.ok(memberNotifications.some((item) => item.kind === "RANKING_CHALLENGE_STATUS"));
  assert.ok(memberNotifications.some((item) => item.kind === "RANKING_APPEAL_STATUS"));
  assert.equal(JSON.stringify([...ownerNotifications, ...memberNotifications]).includes(appealReason), false);
  const notification = memberNotifications[0]!;
  await assert.rejects(
    updateUserNotification(fixture.users.owner.userId, notification.id, "read", notification.revision),
    /USER_NOTIFICATION_NOT_FOUND/,
  );
  const readNotification = await updateUserNotification(fixture.users.member.userId, notification.id, "read", notification.revision);
  const dismissedNotification = await updateUserNotification(fixture.users.member.userId, notification.id, "dismiss", readNotification.revision);
  const restoredNotification = await updateUserNotification(fixture.users.member.userId, notification.id, "restore", dismissedNotification.revision);
  const unreadNotification = await updateUserNotification(fixture.users.member.userId, notification.id, "unread", restoredNotification.revision);
  assert.equal(unreadNotification.readAt, null);
  const notificationExport = await requestDataLifecycleJob(fixture.users.member.actor, {
    kind: "EXPORT",
    scope: "ACCOUNT",
    idempotencyKey: "ab-notification-export-20260906",
  });
  assert.equal(notificationExport.preview && "entries" in notificationExport.preview
    ? notificationExport.preview.entries.some((entry) => entry.kind === "userNotification")
    : false, true);
  const memberExportKinds = notificationExport.preview && "entries" in notificationExport.preview
    ? new Set(notificationExport.preview.entries.map((entry) => entry.kind))
    : new Set<string>();
  assert.equal(memberExportKinds.has("workspace"), true);
  assert.equal(memberExportKinds.has("workspaceMembership"), true);
  assert.equal(memberExportKinds.has("subject"), true);
  const [firstIdempotentNotification, replayedIdempotentNotification] = await prisma.$transaction(async (tx) => {
    const input = {
      actorUserId: fixture.users.owner.userId,
      recipientUserId: fixture.users.member.userId,
      workspaceId: fixture.workspaceIds.primary,
      kind: "RANKING_CHALLENGE_STATUS" as const,
      sourceEntityType: "PRIVATE_CHALLENGE" as const,
      sourceEntityId: challenge.id,
      eventVersion: 999,
    };
    const first = await enqueueRankingNotification(tx, input);
    const replayed = await enqueueRankingNotification(tx, input);
    return [first, replayed] as const;
  });
  assert.equal(firstIdempotentNotification?.id, replayedIdempotentNotification?.id);
  await assert.rejects(prisma.$transaction((tx) => enqueueRankingNotification(tx, {
    actorUserId: fixture.users.owner.userId,
    recipientUserId: fixture.users.operator.userId,
    workspaceId: fixture.workspaceIds.primary,
    kind: "RANKING_CHALLENGE_STATUS",
    sourceEntityType: "PRIVATE_CHALLENGE",
    sourceEntityId: challenge.id,
    eventVersion: 1000,
  })), /USER_NOTIFICATION_TARGET_INVALID/);
  const secondChallenge = await createPrivateChallenge(fixture.users.owner.actor, {
    workspaceId: fixture.workspaceIds.primary,
    name: "隔离候选第二挑战",
    description: null,
    timezone: "Asia/Shanghai",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    targetEffectiveMinutesPerDay: 30,
    publishedFields: ["score"],
  });
  const foreignKeyRejected = (error: unknown) => Boolean(error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === "P2003");
  await assert.rejects(prisma.rankingAppeal.create({
    data: {
      challengeId: secondChallenge.id,
      participantId: invited.id,
      submittedByUserId: fixture.users.member.userId,
      reason: "跨挑战参与者必须被数据库拒绝",
      projectionFingerprint: "b".repeat(64),
    },
  }), foreignKeyRejected);
  await assert.rejects(prisma.rankingAppeal.create({
    data: {
      challengeId: challenge.id,
      participantId: invited.id,
      submittedByUserId: fixture.users.owner.userId,
      reason: "伪造提交者必须被数据库拒绝",
      projectionFingerprint: "c".repeat(64),
    },
  }), foreignKeyRejected);

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
      rankingAppealStatus: accepted.status,
      ownerNotificationCount: ownerNotifications.length,
      memberNotificationCount: memberNotifications.length,
      notificationExportIncluded: true,
      joinedWorkspaceContextIncluded: true,
      workspaceDataJobIsolation: true,
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
