import assert from "node:assert/strict";
import test from "node:test";
import {
  RankingPolicyError,
  assertChallengeRulesMutable,
  assertParticipantCanLeave,
  buildRankingDeletionPlan,
  intersectRankingShareFields,
  normalizeRankingShareFields,
  transitionRankingAppealStatus,
  validateRankingAppealReason,
  transitionPrivateChallengeParticipant,
  transitionPrivateChallengeStatus,
} from "./ranking-policy";

test("排名字段白名单拒绝未知字段并要求 score", () => {
  assert.deepEqual(normalizeRankingShareFields(["score", "active_days"]), ["score", "active_days"]);
  assert.deepEqual(intersectRankingShareFields(["score", "active_days"], ["score", "active_days", "anomaly_count"]), ["score", "active_days"]);
  assert.throws(
    () => normalizeRankingShareFields(["score", "mood"]),
    (error: unknown) => error instanceof RankingPolicyError && error.code === "RANKING_FIELD_NOT_ALLOWED",
  );
  assert.throws(
    () => normalizeRankingShareFields(["active_days"]),
    (error: unknown) => error instanceof RankingPolicyError && error.code === "RANKING_SCORE_FIELD_REQUIRED",
  );
});

test("申诉状态机只允许单向复核并拒绝终态重放", () => {
  assert.equal(transitionRankingAppealStatus("OPEN", "review"), "UNDER_REVIEW");
  assert.equal(transitionRankingAppealStatus("UNDER_REVIEW", "accept"), "ACCEPTED");
  assert.equal(transitionRankingAppealStatus("UNDER_REVIEW", "reject"), "REJECTED");
  assert.equal(transitionRankingAppealStatus("OPEN", "withdraw"), "WITHDRAWN");
  assert.throws(() => transitionRankingAppealStatus("ACCEPTED", "reject"), /RANKING_APPEAL_STATUS_TRANSITION_INVALID/);
  assert.equal(validateRankingAppealReason("  规则异常  "), "规则异常");
  assert.throws(() => validateRankingAppealReason(" "), /RANKING_APPEAL_REASON_INVALID/);
});

test("挑战状态机在开始后冻结规则并拒绝非法转换", () => {
  assert.equal(transitionPrivateChallengeStatus("DRAFT", "start"), "ACTIVE");
  assert.equal(transitionPrivateChallengeStatus("ACTIVE", "end"), "ENDED");
  assert.equal(transitionPrivateChallengeStatus("ENDED", "close"), "CLOSED");
  assert.equal(transitionPrivateChallengeStatus("CLOSED", "dissolve"), "DISSOLVED");
  assert.throws(() => transitionPrivateChallengeStatus("DRAFT", "close"), /RANKING_STATUS_TRANSITION_INVALID/);
  assert.throws(() => assertChallengeRulesMutable("ACTIVE"), /RANKING_RULES_FROZEN/);
});

test("参与者退出与删除计划 fail closed", () => {
  assert.equal(transitionPrivateChallengeParticipant("INVITED", "join"), "ACTIVE");
  assert.equal(transitionPrivateChallengeParticipant("ACTIVE", "leave"), "LEFT");
  assert.throws(
    () => assertParticipantCanLeave({ isOwner: true, activeChallengeCount: 1 }),
    /RANKING_OWNER_EXIT_REQUIRES_TRANSFER/,
  );
  assert.throws(
    () => buildRankingDeletionPlan({
      ownedNonDissolvedChallengeIds: ["challenge-1"],
      ownedDissolvedChallengeIds: [],
      participationIds: [],
      expectedFingerprint: "a",
      actualFingerprint: "a",
    }),
    /RANKING_DELETION_BLOCKED/,
  );
  const plan = buildRankingDeletionPlan({
    ownedNonDissolvedChallengeIds: [],
    ownedDissolvedChallengeIds: ["challenge-closed"],
    participationIds: ["participant-1"],
    expectedFingerprint: "a",
    actualFingerprint: "a",
  });
  assert.deepEqual(plan.ownedDissolvedChallengeIds, ["challenge-closed"]);
  assert.throws(
    () => buildRankingDeletionPlan({
      ownedNonDissolvedChallengeIds: [],
      ownedDissolvedChallengeIds: [],
      participationIds: [],
      expectedFingerprint: "a",
      actualFingerprint: "b",
    }),
    /RANKING_DELETION_CONTRACT_MISMATCH/,
  );
});
