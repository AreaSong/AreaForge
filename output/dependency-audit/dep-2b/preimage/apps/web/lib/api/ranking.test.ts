import assert from "node:assert/strict";
import test from "node:test";
import { createPrivateChallenge, getChallengeProjection, getRankingAppeal, listRankingAppeals, submitRankingAppeal, transitionRankingAppeal, updateRankingPreference } from "./ranking";

test("ranking adapters keep opt-in, challenge and projection routes canonical", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({});
  };
  try {
    await updateRankingPreference("ws-1", { enabled: true, timezone: "Asia/Shanghai", authorizedFields: ["score"], expectedRevision: 1 });
    await createPrivateChallenge({ workspaceId: "ws-1", name: "挑战", timezone: "Asia/Shanghai", startDate: "2026-09-01", endDate: "2026-09-08", targetEffectiveMinutesPerDay: 60, publishedFields: ["score"] });
    await getChallengeProjection("challenge-1");
    await listRankingAppeals("challenge-1");
    await submitRankingAppeal("challenge-1", { participantId: "participant-1", reason: "异常时长需要复核" });
    await transitionRankingAppeal("challenge-1", "appeal-1", "review", 1);
    await getRankingAppeal("challenge-1", "appeal-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["PATCH", "http://local.test/api/ranking/preferences"],
    ["POST", "http://local.test/api/ranking/challenges"],
    ["GET", "http://local.test/api/ranking/challenges/challenge-1/projection"],
    ["GET", "http://local.test/api/ranking/challenges/challenge-1/appeals"],
    ["POST", "http://local.test/api/ranking/challenges/challenge-1/appeals"],
    ["POST", "http://local.test/api/ranking/challenges/challenge-1/appeals/appeal-1"],
    ["GET", "http://local.test/api/ranking/challenges/challenge-1/appeals/appeal-1"],
  ]);
});
