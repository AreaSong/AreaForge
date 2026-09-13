import { RankingNotificationError, type RankingNotificationEvent } from "@areaforge/core";
import type { Prisma } from "../generated/prisma/client";

type Challenge = { id: string; workspaceId: string; ownerUserId: string; status: string; revision: number };
type Participant = { id: string; challengeId: string; userId: string; status: string; revision: number };
type Appeal = { id: string; challengeId: string; participantId: string; submittedByUserId: string; reviewedByUserId: string | null; status: string; revision: number };

export async function assertNotificationSource(tx: Prisma.TransactionClient, event: RankingNotificationEvent, admission: boolean): Promise<void> {
  if (event.sourceEntityType === "PRIVATE_CHALLENGE") {
    const challenge = await lockChallenge(tx, event.sourceEntityId, event.workspaceId);
    version(challenge.revision, event.eventVersion, admission);
    await assertChallengeEvent(tx, event, challenge, admission);
    return;
  }
  if (event.sourceEntityType === "PRIVATE_CHALLENGE_PARTICIPANT") {
    const [participant] = await tx.$queryRaw<Participant[]>`
      SELECT id, "challengeId", "userId", status, revision FROM "PrivateChallengeParticipant" WHERE id = ${event.sourceEntityId} FOR SHARE NOWAIT
    `;
    if (!participant) invalid();
    const challenge = await lockChallenge(tx, participant.challengeId, event.workspaceId);
    version(participant.revision, event.eventVersion, admission);
    assertParticipantEvent(event, participant, challenge, admission);
    return;
  }
  const [appeal] = await tx.$queryRaw<Appeal[]>`
    SELECT id, "challengeId", "participantId", "submittedByUserId", "reviewedByUserId", status, revision FROM "RankingAppeal" WHERE id = ${event.sourceEntityId} FOR SHARE NOWAIT
  `;
  if (!appeal) invalid();
  const challenge = await lockChallenge(tx, appeal.challengeId, event.workspaceId);
  version(appeal.revision, event.eventVersion, admission);
  assertAppealEvent(event, appeal, challenge, admission);
}

async function lockChallenge(tx: Prisma.TransactionClient, id: string, workspaceId: string): Promise<Challenge> {
  const [challenge] = await tx.$queryRaw<Challenge[]>`
    SELECT id, "workspaceId", "ownerUserId", status, revision FROM "PrivateChallenge" WHERE id = ${id} AND "workspaceId" = ${workspaceId} FOR SHARE NOWAIT
  `;
  if (!challenge) invalid();
  return challenge;
}

async function assertChallengeEvent(tx: Prisma.TransactionClient, event: RankingNotificationEvent, challenge: Challenge, admission: boolean) {
  const participants = await tx.$queryRaw<Participant[]>`
    SELECT id, "challengeId", "userId", status, revision FROM "PrivateChallengeParticipant"
    WHERE "challengeId" = ${challenge.id} AND "userId" = ${event.recipientUserId} FOR SHARE NOWAIT
  `;
  const recipient = participants[0];
  if (!recipient) invalid();
  if (event.kind === "RANKING_CHALLENGE_STATUS") {
    if (event.actorUserId !== challenge.ownerUserId || challenge.status === "DRAFT") invalid();
    if (!["ACTIVE", "INVITED"].includes(recipient.status) && !(challenge.status === "DISSOLVED" && recipient.status === "REMOVED")) invalid();
    return;
  }
  if (event.kind !== "RANKING_OWNERSHIP_TRANSFERRED" || challenge.ownerUserId !== event.recipientUserId || recipient.status !== "ACTIVE") invalid();
  // 转移后原 owner 不再是 owner；必须绑定同事务留下的脱敏转移审计，不能猜测旧归属。
  const evidence = await tx.auditEvent.findFirst({ where: {
    actorId: event.actorUserId, entityType: "PrivateChallenge", entityId: challenge.id, action: "RANKING_CHALLENGE_OWNERSHIP_TRANSFERRED",
    AND: [
      { metadata: { path: ["revision"], equals: event.eventVersion } },
      { metadata: { path: ["previousOwnerUserId"], equals: event.actorUserId } },
      { metadata: { path: ["nextOwnerUserId"], equals: event.recipientUserId } },
    ],
  }, select: { id: true } });
  if (!evidence || (admission && challenge.revision !== event.eventVersion)) invalid();
}

function assertParticipantEvent(event: RankingNotificationEvent, participant: Participant, challenge: Challenge, admission: boolean) {
  if (event.kind === "RANKING_PARTICIPANT_STATUS") {
    if (event.actorUserId !== participant.userId || event.recipientUserId !== challenge.ownerUserId) invalid();
    if (admission && !["ACTIVE", "LEFT"].includes(participant.status)) invalid();
    return;
  }
  if (event.actorUserId !== challenge.ownerUserId || event.recipientUserId !== participant.userId) invalid();
  if (event.kind === "RANKING_INVITATION") {
    if (!["INVITED", ...(admission ? [] : ["ACTIVE"])].includes(participant.status)) invalid();
  } else if (event.kind === "RANKING_PARTICIPANT_REMOVED") {
    if (participant.status !== "REMOVED") invalid();
  } else invalid();
}

function assertAppealEvent(event: RankingNotificationEvent, appeal: Appeal, challenge: Challenge, admission: boolean) {
  if (event.kind === "RANKING_APPEAL_STATUS") {
    if (event.actorUserId !== challenge.ownerUserId || appeal.reviewedByUserId !== event.actorUserId || event.recipientUserId !== appeal.submittedByUserId) invalid();
    if (admission && !["UNDER_REVIEW", "ACCEPTED", "REJECTED"].includes(appeal.status)) invalid();
    return;
  }
  if (event.actorUserId !== appeal.submittedByUserId || event.recipientUserId !== challenge.ownerUserId) invalid();
  if (event.kind === "RANKING_APPEAL_WITHDRAWN" && appeal.status !== "WITHDRAWN") invalid();
  if (event.kind === "RANKING_APPEAL_SUBMITTED" && admission && appeal.status !== "OPEN") invalid();
}

function version(actual: number, expected: number, admission: boolean) {
  if (admission ? actual !== expected : actual < expected) invalid();
}
function invalid(): never { throw new RankingNotificationError("USER_NOTIFICATION_SOURCE_INVALID"); }
