import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { previewRankingDeletion } from "./deletion-preview-service";
import { isRankingFeatureEnabled, isRankingProjectionEnabled } from "./feature-gate";

const rankingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

test("ranking feature gate is fail-closed unless explicitly enabled", () => {
  assert.equal(isRankingFeatureEnabled({}), false);
  assert.equal(isRankingFeatureEnabled({ RANKING_ENABLED: "false" }), false);
  assert.equal(isRankingFeatureEnabled({ RANKING_ENABLED: "1" }), false);
  assert.equal(isRankingFeatureEnabled({ RANKING_ENABLED: "true" }), true);
  assert.equal(isRankingProjectionEnabled({ RANKING_PROJECTION_ENABLED: "false" }), false);
  assert.equal(isRankingProjectionEnabled({ RANKING_PROJECTION_ENABLED: "true" }), true);
});

test("ranking writes enqueue only typed durable notifications", async () => {
  const [challenge, appeal, notification] = await Promise.all([
    readFile(path.join(rankingRoot, "challenge-service.ts"), "utf8"),
    readFile(path.join(rankingRoot, "appeal-service.ts"), "utf8"),
    readFile(path.join(rankingRoot, "notification-service.ts"), "utf8"),
  ]);
  assert.match(challenge, /RANKING_INVITATION/);
  assert.match(challenge, /RANKING_CHALLENGE_STATUS/);
  assert.match(challenge, /RANKING_PARTICIPANT_REMOVED/);
  assert.match(challenge, /RANKING_PARTICIPANT_STATUS/);
  assert.match(challenge, /RANKING_OWNERSHIP_TRANSFERRED/);
  assert.match(appeal, /RANKING_APPEAL_SUBMITTED/);
  assert.match(appeal, /RANKING_APPEAL_STATUS/);
  assert.match(appeal, /RANKING_APPEAL_WITHDRAWN/);
  assert.match(notification, /actorUserId === input\.recipientUserId/);
  assert.doesNotMatch(notification, /challenge\.name|appeal\.reason|task\.title/);
});

test("projection loader has a narrow source-field allowlist and workspace fence", async () => {
  const source = await readFile(path.join(rankingRoot, "projection-service.ts"), "utf8");
  assert.match(source, /workspaceId,\s*userId/);
  assert.match(source, /status:\s*"COMPLETED"/);
  assert.match(source, /effectiveMinutes:\s*true/);
  assert.match(source, /isEffective:\s*true/);
  assert.doesNotMatch(source, /row\.(title|note|content|summary|mood|prompt|attachment)/i);
  assert.match(source, /RANKING_PROJECTION_REBUILT/);
});

test("challenge mutations keep owner/member queries behind active workspace membership", async () => {
  const source = await readFile(path.join(rankingRoot, "challenge-service.ts"), "utf8");
  assert.match(source, /workspace:\s*\{[\s\S]*status:\s*"ACTIVE"/);
  assert.match(source, /memberships:\s*\{\s*some:/);
  assert.match(source, /userId:\s*actorId/);
  assert.match(source, /ownerUserId:\s*actorId/);
  assert.match(source, /RANKING_CHALLENGE_NOT_FOUND/);
});

test("ranking deletion preview is read-only, scoped, and fingerprinted", async () => {
  const calls: string[] = [];
  const fakeClient = {
    privateChallenge: {
      findMany: async (args: unknown) => {
        calls.push(`challenge.findMany:${JSON.stringify(args)}`);
        return [{ id: "challenge-a", status: "ACTIVE", revision: 2 }];
      },
    },
    privateChallengeParticipant: {
      findMany: async (args: unknown) => {
        calls.push(`participant.findMany:${JSON.stringify(args)}`);
        return [{ id: "participant-a", challengeId: "challenge-a", status: "ACTIVE", revision: 3 }];
      },
    },
    rankingPreference: {
      count: async (args: unknown) => {
        calls.push(`preference.count:${JSON.stringify(args)}`);
        return 1;
      },
    },
    rankingProjection: {
      count: async (args: unknown) => {
        calls.push(`projection.count:${JSON.stringify(args)}`);
        return 1;
      },
    },
  };
  const input = { userId: "user-a", workspaceId: "workspace-a" };
  const first = await previewRankingDeletion(input, fakeClient as never);
  const second = await previewRankingDeletion(input, fakeClient as never);
  assert.equal(first.action, "preview_only");
  assert.equal(first.blocked, true);
  assert.equal(first.canProceed, false);
  assert.equal(first.reason, "owned_challenges_require_transfer_or_dissolve");
  assert.deepEqual(first.blockers, [{ challengeId: "challenge-a", status: "ACTIVE" }]);
  assert.equal(first.preimageFingerprint, second.preimageFingerprint);
  assert.equal(calls.some((call) => /\.delete|\.update|\.create/.test(call)), false);
  assert.match(calls[0] ?? "", /workspaceId/);
});

test("ranking anti-cheat and appeal services stay local, gated, and audit-backed", async () => {
  const [projection, appeal] = await Promise.all([
    readFile(path.join(rankingRoot, "projection-service.ts"), "utf8"),
    readFile(path.join(rankingRoot, "appeal-service.ts"), "utf8"),
  ]);
  assert.match(projection, /evaluateRankingAntiCheat/);
  assert.match(projection, /antiCheat\.eligible/);
  assert.match(appeal, /requireRankingFeature\(\{ multiUser: true \}\)/);
  assert.match(appeal, /writeRankingAudit/);
  assert.match(appeal, /RANKING_APPEAL_SUBMITTED/);
  assert.match(appeal, /transitionRankingAppealStatus/);
  assert.doesNotMatch(appeal, /sendNotification|sendEmail|fetch\(/i);
});
