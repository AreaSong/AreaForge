import assert from "node:assert/strict";
import test from "node:test";
import { calculateAuthResponseDelay, enforcePasswordResetResponseTiming } from "./response-timing";

test("password reset response timing applies the configured floor and jitter", () => {
  assert.equal(calculateAuthResponseDelay(1_000, { nowMs: 1_150, minimumMs: 600, jitterMs: 75 }), 525);
  assert.equal(calculateAuthResponseDelay(1_000, { nowMs: 1_800, minimumMs: 600, jitterMs: 75 }), 0);
});

test("password reset response timing sleeps only for the remaining duration", async () => {
  const observed: number[] = [];
  await enforcePasswordResetResponseTiming(2_000, {
    nowMs: 2_250,
    minimumMs: 600,
    jitterMs: 50,
    sleep: async (delayMs) => { observed.push(delayMs); },
  });
  assert.deepEqual(observed, [400]);
});
