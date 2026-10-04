import { notificationEventKey, type RankingNotificationEvent } from "../../packages/core/src/index";
import { prisma, claimQueuedDataJob } from "../../packages/db/src/index";
import { enqueueRankingNotification } from "../../apps/web/lib/ranking/notification-service";
import { seedDataJobWorkerFixture } from "./data-job-worker-runtime-fixture";
import { executeDataJob } from "../workers/data-job-execution";
import { createRankingNotificationHandler } from "../workers/ranking-notification-handler";

export async function notificationFixture() {
  const base = await seedDataJobWorkerFixture();
  await prisma.workspaceMembership.create({ data: { userId: base.other.id, workspaceId: base.workspaceA.id, role: "MEMBER" } });
  const challenge = await prisma.privateChallenge.create({ data: {
    workspaceId: base.workspaceA.id, ownerUserId: base.owner.id, name: "不得进入通知的合成挑战名", description: "不得复制的合成正文",
    status: "ACTIVE", timezone: "UTC", startDate: "2026-09-01", endDate: "2026-09-30", targetEffectiveMinutesPerDay: 30,
  } });
  await prisma.privateChallengeParticipant.create({ data: { challengeId: challenge.id, userId: base.owner.id, status: "ACTIVE" } });
  const participant = await prisma.privateChallengeParticipant.create({ data: { challengeId: challenge.id, userId: base.other.id, status: "INVITED" } });
  const event: RankingNotificationEvent = {
    actorUserId: base.owner.id, recipientUserId: base.other.id, workspaceId: base.workspaceA.id,
    kind: "RANKING_INVITATION", sourceEntityType: "PRIVATE_CHALLENGE_PARTICIPANT", sourceEntityId: participant.id, eventVersion: 1,
  };
  return { ...base, challenge, participant, event };
}

export const enqueueEvent = (event: RankingNotificationEvent) => prisma.$transaction(tx => enqueueRankingNotification(tx, event));
export const readJob = (jobId: string) => prisma.dataJob.findUniqueOrThrow({ where: { id: jobId } });
export const notificationCount = (event: RankingNotificationEvent) => prisma.userNotification.count({ where: { recipientUserId: event.recipientUserId, eventKey: notificationEventKey(event) } });

export async function consumeEvent(event: RankingNotificationEvent) {
  const lease = await claimQueuedDataJob(prisma, { workerId: "notification-runtime", kinds: ["NOTIFICATION"], leaseMs: 30_000, partition: { requestedByUserId: event.actorUserId, workspaceId: event.workspaceId } });
  if (!lease) throw new Error("FIXTURE_JOB_NOT_CLAIMED");
  const result = await executeDataJob({ client: prisma, lease, leaseMs: 30_000, signal: new AbortController().signal, handler: createRankingNotificationHandler() });
  return { result, job: await readJob(lease.jobId) };
}
