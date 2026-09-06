import assert from "node:assert/strict";
import test from "node:test";
import { replayRankingAppealEvents } from "./appeal-service";

function metadata(status: "OPEN" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "WITHDRAWN", revision: number) {
  return {
    contractVersion: "ranking-appeal-v1",
    appealId: "appeal-1",
    challengeId: "challenge-1",
    participantId: "participant-1",
    status,
    revision,
    submittedByUserId: "user-1",
    reason: "重复时长需要复核",
    projectionFingerprint: "a".repeat(64),
  };
}

test("申诉读侧重放按 revision 保留单一最新状态", () => {
  const appeals = replayRankingAppealEvents([
    { id: "1", metadata: metadata("OPEN", 1), createdAt: new Date("2026-09-06T00:00:00Z") },
    { id: "2", metadata: metadata("UNDER_REVIEW", 2), createdAt: new Date("2026-09-06T00:01:00Z") },
    { id: "stale", metadata: metadata("REJECTED", 1), createdAt: new Date("2026-09-06T00:02:00Z") },
    { id: "3", metadata: metadata("ACCEPTED", 3), createdAt: new Date("2026-09-06T00:03:00Z") },
  ]);
  assert.equal(appeals.length, 1);
  assert.equal(appeals[0]?.status, "ACCEPTED");
  assert.equal(appeals[0]?.revision, 3);
  assert.equal(appeals[0]?.reason, "重复时长需要复核");
});

test("申诉读侧对损坏审计 metadata fail closed", () => {
  const appeals = replayRankingAppealEvents([
    { id: "bad", metadata: { contractVersion: "other", status: "ACCEPTED" }, createdAt: new Date() },
  ]);
  assert.deepEqual(appeals, []);
});
