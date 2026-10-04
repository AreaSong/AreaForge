import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prisma } from "../../packages/db/src/index";
import type { CurrentUser } from "../../apps/web/lib/auth/session";
import { removePrivateChallengeParticipant, transferPrivateChallengeOwnership, transitionPrivateChallenge } from "../../apps/web/lib/ranking/challenge-service";
import { transitionRankingAppeal } from "../../apps/web/lib/ranking/appeal-service";
import { consumeEvent, notificationFixture } from "./ranking-notification-runtime-fixture";

type RecipientState = "LEFT" | "REMOVED" | "SUSPENDED";
type SourceAction = "end" | "dissolve" | "remove" | "review";

export async function unavailableRecipientsDoNotBlockSource() {
  await withSourceFlags(async () => {
    for (const queued of [false, true]) {
      process.env.PLATFORM_NOTIFICATION_QUEUE_ENABLED = String(queued);
      for (const state of ["LEFT", "REMOVED", "SUSPENDED"] as const) {
        for (const action of ["end", "dissolve", "remove", "review"] as const) await verifyUnavailableRecipient({ queued, state, action });
      }
    }
  });
}

export async function ownershipTargetsRemainAuthorized() {
  await withSourceFlags(async () => {
    for (const mode of ["off", "direct", "queue"]) {
      process.env.PLATFORM_NOTIFICATIONS_ENABLED = String(mode !== "off");
      process.env.PLATFORM_NOTIFICATION_QUEUE_ENABLED = String(mode === "queue");
      for (const state of ["LEFT", "REMOVED", "SUSPENDED"] as const) await verifyOwnershipTarget(state);
    }
  });
}

async function withSourceFlags(run: () => Promise<void>) {
  const keys = ["AUTH_MULTI_USER_ENABLED", "AUTH_RBAC_ENABLED", "RANKING_ENABLED", "AUTH_SESSION_SECRET", "AUTH_ACTION_TOKEN_SECRET", "PLATFORM_NOTIFICATION_QUEUE_ENABLED", "PLATFORM_NOTIFICATIONS_ENABLED"];
  const original = keys.map(key => process.env[key]);
  try {
    for (const key of keys.slice(0, 3)) process.env[key] = "true";
    process.env.AUTH_SESSION_SECRET = "notification-source-fixture-only".repeat(2);
    process.env.AUTH_ACTION_TOKEN_SECRET = "notification-action-fixture-only".repeat(2);
    await run();
  } finally {
    keys.forEach((key, index) => { if (original[index] === undefined) delete process.env[key]; else process.env[key] = original[index]; });
  }
}

async function verifyOwnershipTarget(state: RecipientState) {
  const fixture = await notificationFixture();
  const { owner, other, workspaceA, challenge, participant } = fixture;
  const now = new Date();
  const session = await prisma.authSession.create({ data: { userId: owner.id, authRevision: owner.authRevision, tokenHash: createHash("sha256").update(fixture.prefix).digest("hex"), reauthenticatedAt: now, expiresAt: new Date(now.getTime() + 60_000) } });
  const actor: CurrentUser = { id: owner.id, email: owner.email, status: "ACTIVE", sessionId: session.id, emailVerifiedAt: null, reauthenticatedAt: now };
  await prisma.privateChallengeParticipant.update({ where: { id: participant.id }, data: { status: "ACTIVE" } });
  await prisma.rankingPreference.create({ data: { userId: other.id, workspaceId: workspaceA.id, enabled: true } });
  if (state === "SUSPENDED") await prisma.user.update({ where: { id: other.id }, data: { status: "SUSPENDED", authRevision: { increment: 1 } } });
  else await prisma.workspaceMembership.update({ where: { workspaceId_userId: { workspaceId: workspaceA.id, userId: other.id } }, data: { status: state, revision: { increment: 1 } } });
  await assert.rejects(transferPrivateChallengeOwnership(actor, challenge.id, participant.id, challenge.revision), { code: "RANKING_WORKSPACE_NOT_FOUND" });
  const unchanged = await prisma.privateChallenge.findUniqueOrThrow({ where: { id: challenge.id } });
  assert.equal(unchanged.ownerUserId, owner.id); assert.equal(unchanged.revision, challenge.revision);
  assert.equal(await prisma.auditEvent.count({ where: { entityId: challenge.id, action: "RANKING_CHALLENGE_OWNERSHIP_TRANSFERRED" } }), 0);
  assert.equal(await prisma.dataJob.count({ where: { workspaceId: workspaceA.id } }), 0);
  assert.equal(await prisma.userNotification.count({ where: { workspaceId: workspaceA.id } }), 0);
  if (state === "SUSPENDED") await prisma.user.update({ where: { id: other.id }, data: { status: "ACTIVE", authRevision: { increment: 1 } } });
  else await prisma.workspaceMembership.update({ where: { workspaceId_userId: { workspaceId: workspaceA.id, userId: other.id } }, data: { status: "ACTIVE", revision: { increment: 1 } } });
  assert.equal((await transferPrivateChallengeOwnership(actor, challenge.id, participant.id, challenge.revision)).ownerUserId, other.id);
  if (process.env.PLATFORM_NOTIFICATION_QUEUE_ENABLED === "true") assert.equal((await consumeEvent(fixture.event)).result, "SUCCEEDED");
}

async function verifyUnavailableRecipient(input: { queued: boolean; state: RecipientState; action: SourceAction }) {
  const fixture = await notificationFixture();
  const { owner, other, workspaceA, challenge, participant } = fixture;
  if (input.state === "SUSPENDED") await prisma.user.update({ where: { id: other.id }, data: { status: "SUSPENDED", authRevision: { increment: 1 } } });
  else await prisma.workspaceMembership.update({ where: { workspaceId_userId: { workspaceId: workspaceA.id, userId: other.id } }, data: { status: input.state, revision: { increment: 1 } } });
  const actor: CurrentUser = { id: owner.id, email: owner.email, status: "ACTIVE", sessionId: "fixture", emailVerifiedAt: null, reauthenticatedAt: null };
  if (input.action === "remove") {
    assert.equal((await removePrivateChallengeParticipant(actor, challenge.id, participant.id)).status, "REMOVED");
  } else if (input.action === "review") {
    const appeal = await prisma.rankingAppeal.create({ data: { challengeId: challenge.id, participantId: participant.id, submittedByUserId: other.id, reason: "合成申诉正文", projectionFingerprint: "a".repeat(64) } });
    assert.equal((await transitionRankingAppeal(actor, challenge.id, appeal.id, { action: "review", expectedRevision: 1 })).status, "UNDER_REVIEW");
  } else {
    const active = await addActiveRecipient(fixture);
    const updated = await transitionPrivateChallenge(actor, challenge.id, input.action, challenge.revision);
    assert.equal(updated.status, input.action === "end" ? "ENDED" : "DISSOLVED");
    if (input.queued) assert.equal((await consumeEvent(fixture.event)).result, "SUCCEEDED");
    assert.equal(await prisma.userNotification.count({ where: { recipientUserId: active.id, workspaceId: workspaceA.id } }), 1);
  }
  assert.equal(await prisma.userNotification.count({ where: { recipientUserId: other.id, workspaceId: workspaceA.id } }), 0);
  assert.equal(await prisma.dataJob.count({ where: { workspaceId: workspaceA.id, status: { not: "SUCCEEDED" } } }), 0);
}

async function addActiveRecipient(fixture: Awaited<ReturnType<typeof notificationFixture>>) {
  const user = await prisma.user.create({ data: { id: `${fixture.prefix}_active`, email: `${fixture.prefix}_active@example.test`, passwordHash: "synthetic-not-a-password-hash" } });
  await prisma.workspaceMembership.create({ data: { workspaceId: fixture.workspaceA.id, userId: user.id, role: "MEMBER" } });
  await prisma.privateChallengeParticipant.create({ data: { challengeId: fixture.challenge.id, userId: user.id, status: "ACTIVE" } });
  return user;
}
