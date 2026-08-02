import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLocalFocusCommand, createLocalFocusSession } from "@/lib/client/focus-offline-store";

test("local focus projection preserves paused time and closes with evidence", () => {
  const startedAt = new Date("2026-08-03T00:00:00.000Z");
  const session = createLocalFocusSession({
    userId: "user-1",
    subjectId: "subject-1",
    subjectName: "数学",
  }, startedAt);

  const paused = applyLocalFocusCommand(session, "pause", {}, new Date("2026-08-03T00:10:00.000Z"));
  const resumed = applyLocalFocusCommand(paused, "resume", {}, new Date("2026-08-03T00:12:30.000Z"));
  const completed = applyLocalFocusCommand(resumed, "end", {
    isEffective: true,
    qualityScore: 4,
    understandingLevel: "基本理解",
    minimalOutput: "完成一页推导",
    nextAction: "明天复测",
  }, new Date("2026-08-03T00:22:30.000Z"));

  assert.equal(paused.status, "paused");
  assert.equal(resumed.status, "running");
  assert.equal(resumed.accumulatedPauseSeconds, 150);
  assert.equal(completed.status, "completed");
  assert.equal(completed.effectiveMinutes, 20);
  assert.equal(completed.isEffective, true);
  assert.equal(completed.isLowConversion, false);
  assert.equal(completed.minimalOutput, "完成一页推导");
});

test("local focus projection ignores invalid state transitions", () => {
  const now = new Date("2026-08-03T00:00:00.000Z");
  const session = createLocalFocusSession({ userId: "user-1", subjectId: "subject-1", subjectName: "数学" }, now);
  assert.deepEqual(applyLocalFocusCommand(session, "resume", {}, now), session);
  const completed = applyLocalFocusCommand(session, "end", { isEffective: false }, now);
  assert.deepEqual(applyLocalFocusCommand(completed, "pause", {}, new Date("2026-08-03T00:01:00.000Z")), completed);
});
