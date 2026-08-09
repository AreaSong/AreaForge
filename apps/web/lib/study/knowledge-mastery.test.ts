import assert from "node:assert/strict";
import { test } from "node:test";
import { masteryStateForRetest } from "@/lib/study/knowledge-mastery";

const day = 24 * 60 * 60 * 1000;

test("the first passed retest records initial mastery", () => {
  const state = masteryStateForRetest({
    result: "PASSED",
    currentState: "LEARNING",
    testedAt: new Date("2026-08-03T00:00:00.000Z"),
    previousEvidence: [],
    method: "主动回忆 + 讲解",
  });

  assert.equal(state, "INITIAL_MASTERY");
});

test("stable mastery needs a delayed passed variant retest", () => {
  const state = masteryStateForRetest({
    result: "PASSED",
    currentState: "INITIAL_MASTERY",
    testedAt: new Date("2026-08-10T00:00:00.000Z"),
    previousEvidence: [{
      occurredAt: new Date("2026-08-03T00:00:00.000Z"),
      dimensions: { result: "PASSED", method: "基础题" },
    }],
    method: "变式应用",
  });

  assert.equal(state, "STABLE_MASTERY");
  assert.ok(new Date("2026-08-10T00:00:00.000Z").getTime() - new Date("2026-08-03T00:00:00.000Z").getTime() >= 7 * day);
});

test("a failed retest does not lower existing mastery", () => {
  assert.equal(masteryStateForRetest({
    result: "FAILED",
    currentState: "STABLE_MASTERY",
    testedAt: new Date("2026-08-03T00:00:00.000Z"),
    previousEvidence: [],
    method: "基础题",
  }), "STABLE_MASTERY");

  assert.equal(masteryStateForRetest({
    result: "PARTIAL",
    currentState: "INITIAL_MASTERY",
    testedAt: new Date("2026-08-03T00:00:00.000Z"),
    previousEvidence: [],
    method: "基础题",
  }), "INITIAL_MASTERY");
});
