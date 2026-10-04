import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLocalFocusCommand, createLocalFocusSession, rebaseFocusCommand } from "@/lib/client/focus-offline-store";

test("local focus projection preserves paused time and closes with evidence", () => {
  const startedAt = new Date("2026-08-03T00:00:00.000Z");
  const session = createLocalFocusSession({
    userId: "user-1",
    subjectId: "subject-1",
    subjectName: "数学",
  }, startedAt);

  const paused = applyLocalFocusCommand(session, "pause", {}, new Date("2026-08-03T00:10:00.000Z"));
  const resumed = applyLocalFocusCommand(paused, "resume", {}, new Date("2026-08-03T00:12:30.000Z"));
  const closing = applyLocalFocusCommand(resumed, "end", { mode: "prepare" }, new Date("2026-08-03T00:22:30.000Z"));
  const completed = applyLocalFocusCommand(closing, "end", {
    isEffective: true,
    qualityScore: 4,
    understandingLevel: "基本理解",
    minimalOutput: "完成一页推导",
    nextAction: "明天复测",
  }, new Date("2026-08-03T00:22:30.000Z"));

  assert.equal(paused.status, "paused");
  assert.equal(resumed.status, "running");
  assert.equal(resumed.accumulatedPauseSeconds, 150);
  assert.equal(completed.status, "closing");
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
  assert.deepEqual(completed, session);
});

test("local closeout freezes the timer before evidence is submitted", () => {
  const startedAt = new Date("2026-08-03T00:00:00.000Z");
  const session = createLocalFocusSession({ userId: "user-1", subjectId: "subject-1", subjectName: "数学" }, startedAt);
  const closing = applyLocalFocusCommand(session, "end", { mode: "prepare" }, new Date("2026-08-03T00:10:00.000Z"));
  const completed = applyLocalFocusCommand(closing, "end", {
    mode: "complete",
    isEffective: true,
    qualityScore: 4,
    understandingLevel: "清晰",
    minimalOutput: "完成一道综合题",
    nextAction: "两天后复测",
  }, new Date("2026-08-03T00:40:00.000Z"));

  assert.equal(closing.status, "closing");
  assert.equal(closing.endedAt, "2026-08-03T00:10:00.000Z");
  assert.equal(closing.effectiveMinutes, 10);
  assert.equal(completed.status, "closing");
  assert.equal(completed.endedAt, closing.endedAt);
  assert.equal(completed.effectiveMinutes, 10);
});

test("local closeout includes the paused interval when paused directly", () => {
  const startedAt = new Date("2026-08-03T00:00:00.000Z");
  const session = createLocalFocusSession({ userId: "user-1", subjectId: "subject-1", subjectName: "数学" }, startedAt);
  const paused = applyLocalFocusCommand(session, "pause", {}, new Date("2026-08-03T00:05:00.000Z"));
  const closing = applyLocalFocusCommand(paused, "end", { mode: "prepare" }, new Date("2026-08-03T00:10:00.000Z"));

  assert.equal(closing.status, "closing");
  assert.equal(closing.accumulatedPauseSeconds, 300);
  assert.equal(closing.effectiveMinutes, 5);
});

test("local context updates and low-conversion feedback stay in the offline projection", () => {
  const startedAt = new Date("2026-08-03T00:00:00.000Z");
  const session = createLocalFocusSession({ userId: "user-1", subjectId: "subject-1", subjectName: "数学" }, startedAt);
  const contextual = applyLocalFocusCommand(session, "context", {
    taskId: "task-1",
    taskTitle: "极限的定义",
    syllabusNodeId: "node-1",
    syllabusNodeTitle: "函数极限",
  }, new Date("2026-08-03T00:01:00.000Z"));
  const completed = applyLocalFocusCommand(contextual, "end", {
    mode: "prepare",
  }, new Date("2026-08-03T00:11:00.000Z"));
  const closed = applyLocalFocusCommand(completed, "end", {
    mode: "complete",
    isEffective: false,
    qualityScore: 2,
    understandingLevel: "模糊",
    minimalOutput: "记录卡点",
    nextAction: "补看定义并做题",
    lowReasons: ["NOT_UNDERSTOOD", "MATERIAL_BLOCKED"],
    focusLevel: 2,
    energyLevel: 3,
    nextDisposition: "加入补充学习",
  }, new Date("2026-08-03T00:20:00.000Z"));

  assert.equal(contextual.taskId, "task-1");
  assert.equal(contextual.taskTitle, "极限的定义");
  assert.equal(contextual.syllabusNodeTitle, "函数极限");
  assert.deepEqual(closed.lowReasons, ["NOT_UNDERSTOOD", "MATERIAL_BLOCKED"]);
  assert.equal(closed.focusLevel, 2);
  assert.equal(closed.energyLevel, 3);
  assert.equal(closed.nextDisposition, "加入补充学习");
  assert.equal(closed.isLowConversion, true);
});

test("local focus start preserves recovery goal and task provenance", () => {
  const session = createLocalFocusSession({
    userId: "user-1",
    subjectId: "subject-1",
    subjectName: "数学",
    taskId: "task-1",
    taskTitle: "极限复习",
    goalMinutes: 30,
    startSource: "RECOVERY",
  }, new Date("2026-08-03T00:00:00.000Z"));

  assert.equal(session.taskId, "task-1");
  assert.equal(session.goalMinutes, 30);
  assert.equal(session.startSource, "RECOVERY");
});

test("offline command rebases CAS fields onto the latest server session", () => {
  const body = { expectedStatus: "running", expectedUpdatedAt: "old", idempotencyKey: "command-123" };
  assert.deepEqual(rebaseFocusCommand("pause", body, { status: "paused", updatedAt: "new" }), {
    expectedStatus: "paused",
    expectedUpdatedAt: "new",
    idempotencyKey: "command-123",
  });
});
