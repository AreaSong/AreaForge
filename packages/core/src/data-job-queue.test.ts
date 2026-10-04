import assert from "node:assert/strict";
import test from "node:test";
import { planDataJobFailure, validateDataJobAttempts, validateDataJobLeaseDuration } from "./data-job-queue";

const now = "2026-09-08T00:00:00.000Z";

test("任务失败使用已执行次数计算退避，最大次数不能多跑一次", () => {
  const decision = (attempt: number) => planDataJobFailure({ attempt, maxAttempts: 5, retryable: true, errorCode: "TRANSIENT", now });
  assert.equal(decision(1).nextAttemptAt, "2026-09-08T00:00:30.000Z");
  assert.equal(decision(2).nextAttemptAt, "2026-09-08T00:01:00.000Z");
  assert.equal(decision(4).retryable, true);
  assert.deepEqual(decision(5), { status: "FAILED", retryable: false, nextAttemptAt: null, deadLetteredAt: now, errorCode: "TRANSIENT" });
  assert.equal(decision(6).retryable, false);
});

test("非重试错误直接进入持久死信，退避有上限", () => {
  assert.equal(planDataJobFailure({ attempt: 1, maxAttempts: 5, retryable: false, errorCode: "DENIED", now }).deadLetteredAt, now);
  assert.equal(planDataJobFailure({ attempt: 99, maxAttempts: 100, retryable: true, errorCode: "TIMEOUT", now }).nextAttemptAt, "2026-09-08T01:00:00.000Z");
});

test("拒绝无效租约、尝试次数、时间和自由错误正文", () => {
  for (const value of [0, -1, 101, NaN, 1.5]) assert.throws(() => validateDataJobAttempts(value));
  for (const value of [0, 999, 900_001, NaN]) assert.throws(() => validateDataJobLeaseDuration(value));
  validateDataJobLeaseDuration(1_000);
  validateDataJobLeaseDuration(900_000);
  const input = { attempt: 1, maxAttempts: 5, retryable: true, errorCode: "TRANSIENT", now };
  assert.throws(() => planDataJobFailure({ ...input, attempt: 0 }));
  assert.throws(() => planDataJobFailure({ ...input, now: "bad" }));
  assert.throws(() => planDataJobFailure({ ...input, errorCode: "raw private message" }));
});
