import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DAILY_EFFECTIVE_SECONDS,
  MAX_SESSION_SECONDS,
  PERSONAL_GROWTH_SCORE_VERSION,
  PRIVATE_CHALLENGE_SCORE_VERSION,
  RankingInputError,
  calculatePersonalGrowthScore,
  calculatePrivateChallengeScore,
  evaluateRankingAntiCheat,
  rankPrivateChallengeScores,
} from "./ranking-metrics";

const baseInput = {
  timezone: "Asia/Shanghai",
  baselineWindow: { startDate: "2026-01-01", endDate: "2026-01-03" },
  currentWindow: { startDate: "2026-01-03", endDate: "2026-01-05" },
  sessions: [
    {
      id: "baseline-day-1",
      startedAt: "2025-12-31T16:00:00Z",
      endedAt: "2025-12-31T17:00:00Z",
      effectiveSeconds: 3600,
      minimumActionCompleted: true,
    },
    {
      id: "current-day-1",
      startedAt: "2026-01-02T16:00:00Z",
      endedAt: "2026-01-02T18:00:00Z",
      effectiveSeconds: 7200,
      minimumActionCompleted: true,
    },
  ],
} as const;

test("个人成长分数带 scoreVersion，并按用户时区计算窗口日", () => {
  const result = calculatePersonalGrowthScore(baseInput);

  assert.equal(result.scoreVersion, PERSONAL_GROWTH_SCORE_VERSION);
  assert.equal(result.baseline.windowDays, 2);
  assert.equal(result.current.windowDays, 2);
  assert.equal(result.baseline.effectiveMinutes, 60);
  assert.equal(result.current.effectiveMinutes, 120);
  assert.equal(result.baseline.activeDays, 1);
  assert.equal(result.current.activeDays, 1);
  assert.ok(result.score > 50);
  assert.match(result.explanation, /有效学习时长/);
});

test("相同输入无论顺序如何都得到相同分数和异常集合", () => {
  const forward = calculatePersonalGrowthScore(baseInput);
  const reversed = calculatePersonalGrowthScore({ ...baseInput, sessions: [...baseInput.sessions].reverse() });

  assert.equal(reversed.score, forward.score);
  assert.deepEqual(reversed.components, forward.components);
  assert.deepEqual(reversed.anomalies, forward.anomalies);
});

test("窗口必须是相同长度、半开区间且基线先于当前窗口", () => {
  assert.throws(
    () =>
      calculatePersonalGrowthScore({
        ...baseInput,
        currentWindow: { startDate: "2026-01-03", endDate: "2026-01-06" },
      }),
    (error: unknown) => error instanceof RankingInputError && error.code === "WINDOW_INVALID",
  );
  assert.throws(
    () =>
      calculatePersonalGrowthScore({
        ...baseInput,
        currentWindow: { startDate: "2026-01-02", endDate: "2026-01-04" },
      }),
    (error: unknown) => error instanceof RankingInputError && error.code === "WINDOW_OVERLAP",
  );
  assert.throws(
    () =>
      calculatePersonalGrowthScore({
        ...baseInput,
        timezone: "Not/A-Timezone",
      }),
    (error: unknown) => error instanceof RankingInputError && error.code === "TIMEZONE_INVALID",
  );
});

test("重复、异常和超长 session 不进入分数，并记录可解释异常", () => {
  const result = calculatePrivateChallengeScore({
    timezone: "UTC",
    window: { startDate: "2026-01-01", endDate: "2026-01-02" },
    targetEffectiveMinutesPerDay: 60,
    sessions: [
      {
        id: "duplicate",
        startedAt: "2026-01-01T01:00:00Z",
        endedAt: "2026-01-01T02:00:00Z",
        effectiveSeconds: 3600,
      },
      {
        id: "duplicate",
        startedAt: "2026-01-01T03:00:00Z",
        endedAt: "2026-01-01T04:00:00Z",
        effectiveSeconds: 3600,
      },
      {
        id: "too-long",
        startedAt: "2026-01-01T05:00:00Z",
        endedAt: "2026-01-01T18:00:01Z",
        effectiveSeconds: MAX_SESSION_SECONDS,
      },
      {
        id: "bad-effective",
        startedAt: "2026-01-01T19:00:00Z",
        endedAt: "2026-01-01T19:30:00Z",
        effectiveSeconds: 3601,
      },
      {
        id: "outside",
        startedAt: "2026-01-02T01:00:00Z",
        endedAt: "2026-01-02T02:00:00Z",
        effectiveSeconds: 3600,
      },
    ],
  });

  assert.equal(result.scoreVersion, PRIVATE_CHALLENGE_SCORE_VERSION);
  assert.equal(result.aggregate.effectiveSeconds, 0);
  assert.deepEqual(
    new Set(result.anomalies.map((anomaly) => anomaly.code)),
    new Set(["duplicate_session", "duration_exceeds_limit", "effective_seconds_exceeds_elapsed", "outside_window"]),
  );
});

test("单日有效时长有上限，防止拆分 session 刷分", () => {
  const result = calculatePrivateChallengeScore({
    timezone: "UTC",
    window: { startDate: "2026-01-01", endDate: "2026-01-02" },
    targetEffectiveMinutesPerDay: 60,
    sessions: [
      { id: "a", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T10:00:00Z", effectiveSeconds: 36_000 },
      { id: "b", startedAt: "2026-01-01T11:00:00Z", endedAt: "2026-01-01T21:00:00Z", effectiveSeconds: 36_000 },
    ],
  });

  assert.equal(result.aggregate.effectiveSeconds, MAX_DAILY_EFFECTIVE_SECONDS);
  assert.equal(result.anomalies[0]?.code, "daily_effective_cap");
});

test("反作弊判定只按纯规则异常分级且未知代码 fail closed", () => {
  assert.equal(evaluateRankingAntiCheat({ anomalies: [] }).status, "CLEAR");
  const review = evaluateRankingAntiCheat({ anomalies: [{ code: "daily_effective_cap", window: "challenge", detail: "cap" }] });
  assert.equal(review.status, "REVIEW");
  assert.equal(review.eligible, true);
  const excluded = evaluateRankingAntiCheat({ anomalies: [{ code: "duplicate_session", window: "challenge", detail: "duplicate" }] });
  assert.equal(excluded.status, "EXCLUDED");
  assert.equal(excluded.shouldExclude, true);
  const unknown = evaluateRankingAntiCheat({ anomalies: [{ code: "new_rule" as never, window: "challenge", detail: "unknown" }] });
  assert.equal(unknown.status, "EXCLUDED");
});

test("敏感字段和未经允许的字段在运行时被拒绝", () => {
  assert.throws(
    () =>
      calculatePrivateChallengeScore({
        timezone: "UTC",
        window: { startDate: "2026-01-01", endDate: "2026-01-02" },
        targetEffectiveMinutesPerDay: 60,
        sessions: [],
        privateTaskTitle: "不可进入排名" as never,
      } as never),
    (error: unknown) => error instanceof RankingInputError && error.code === "SENSITIVE_FIELD_FORBIDDEN",
  );
  assert.throws(
    () =>
      calculatePrivateChallengeScore({
        timezone: "UTC",
        window: { startDate: "2026-01-01", endDate: "2026-01-02" },
        targetEffectiveMinutesPerDay: 60,
        sessions: [
          {
            id: "safe-id",
            startedAt: "2026-01-01T00:00:00Z",
            endedAt: "2026-01-01T01:00:00Z",
            effectiveSeconds: 3600,
            noteContent: "不可进入排名",
          } as never,
        ],
      }),
    (error: unknown) => error instanceof RankingInputError && error.code === "SENSITIVE_FIELD_FORBIDDEN",
  );
});

test("私有挑战排名采用稳定的竞赛并列名次", () => {
  const ranked = rankPrivateChallengeScores([
    { participantKey: "user-b", score: 80 },
    { participantKey: "user-a", score: 80 },
    { participantKey: "user-c", score: 70 },
  ]);

  assert.deepEqual(
    ranked.map((entry) => [entry.participantKey, entry.rank, entry.tieGroup, entry.tied]),
    [
      ["user-a", 1, 1, true],
      ["user-b", 1, 1, true],
      ["user-c", 3, 3, false],
    ],
  );
  assert.throws(
    () => rankPrivateChallengeScores([{ participantKey: "user-a", score: 10 }, { participantKey: "user-a", score: 9 }]),
    (error: unknown) => error instanceof RankingInputError && error.code === "PARTICIPANT_DUPLICATE",
  );
});
