import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasRecentFailure,
  isDue,
  isPracticeReady,
  selectMistakePracticeCandidates,
} from "@/lib/knowledge/mistake-practice";
import type { MistakeAttemptDto, MistakeDto } from "@/lib/contracts/mistake";

const NOW = new Date("2026-08-19T00:00:00.000Z");

function makeMistake(id: string, overrides: Partial<MistakeDto> = {}): MistakeDto {
  return {
    id,
    subjectId: "subject-1",
    subjectName: "数学",
    subjectColor: "#14b8a6",
    syllabusNodeId: null,
    syllabusNodeTitle: null,
    title: `题目 ${id}`,
    questionText: "已补全题面",
    source: null,
    cause: "concept_confusion",
    causeNote: null,
    correctAnswer: null,
    correctIdea: "已补全正确思路",
    nextReviewAt: null,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    attemptCount: 0,
    lastAttemptAt: null,
    attempts: [],
    noteLinks: [],
    resourceLinks: [],
    reviewSchedule: null,
    reviewHistory: [],
    ...overrides,
  };
}

function attempt(id: string, result: MistakeAttemptDto["result"], attemptedAt: string): MistakeAttemptDto {
  return {
    id,
    reviewEventId: null,
    answerMode: "TEXT",
    answerText: "答案",
    result,
    durationSeconds: 10,
    note: null,
    attemptedAt,
  };
}

function activeSchedule(dueDate: string | null, id = "schedule-1"): MistakeDto["reviewSchedule"] {
  return {
    id,
    status: "ACTIVE",
    dueDate,
    pausedReason: null,
    consecutivePassCount: 0,
    revision: 1,
    updatedAt: "2026-08-18T00:00:00.000Z",
  };
}

test("mixed pool keeps due items first, then latest failures, then remaining items", () => {
  const dueLater = makeMistake("due-later", { reviewSchedule: activeSchedule("2026-08-18T00:00:00.000Z", "schedule-later") });
  const dueSoon = makeMistake("due-soon", { reviewSchedule: activeSchedule("2026-08-15T00:00:00.000Z", "schedule-soon") });
  const failed = makeMistake("failed", {
    attempts: [attempt("failed-attempt", "FAILED", "2026-08-17T12:00:00.000Z")],
  });
  const remaining = makeMistake("remaining", { updatedAt: "2026-08-19T00:00:00.000Z" });

  const selected = selectMistakePracticeCandidates([remaining, failed, dueLater, dueSoon], {
    pool: "mixed",
    count: 4,
    now: NOW,
  });

  assert.deepEqual(selected.map((mistake) => mistake.id), ["due-soon", "due-later", "failed", "remaining"]);
});

test("pool filters use the latest attempt result and active schedule state", () => {
  const latestFailed = makeMistake("latest-failed", {
    attempts: [
      attempt("new-failure", "FAILED", "2026-08-18T12:00:00.000Z"),
      attempt("old-pass", "PASSED", "2026-08-17T12:00:00.000Z"),
    ],
  });
  const recovered = makeMistake("recovered", {
    attempts: [
      attempt("new-pass", "PASSED", "2026-08-18T12:00:00.000Z"),
      attempt("old-failure", "FAILED", "2026-08-17T12:00:00.000Z"),
    ],
  });
  const due = makeMistake("due", { reviewSchedule: activeSchedule("2026-08-18T00:00:00.000Z", "schedule-due") });
  const paused = makeMistake("paused", {
    reviewSchedule: { ...activeSchedule(null, "schedule-paused")!, status: "PAUSED", pausedReason: "manual" },
  });
  const unscheduled = makeMistake("unscheduled");

  assert.equal(hasRecentFailure(latestFailed), true);
  assert.equal(hasRecentFailure(recovered), false);
  assert.deepEqual(
    selectMistakePracticeCandidates([latestFailed, recovered, due, paused, unscheduled], { pool: "failed", count: 50, now: NOW }).map((mistake) => mistake.id),
    ["latest-failed"],
  );
  assert.deepEqual(
    selectMistakePracticeCandidates([latestFailed, recovered, due, paused, unscheduled], { pool: "due", count: 50, now: NOW }).map((mistake) => mistake.id),
    ["due"],
  );
  assert.deepEqual(
    selectMistakePracticeCandidates([latestFailed, recovered, due, paused, unscheduled], { pool: "unscheduled", count: 50, now: NOW }).map((mistake) => mistake.id),
    ["latest-failed", "recovered", "unscheduled"],
  );
  assert.equal(isDue(due, NOW), true);
  assert.equal(isDue(paused, NOW), false);
});

test("incomplete and archived mistakes are never practice candidates, and count is capped", () => {
  const ready = makeMistake("ready");
  const archived = makeMistake("archived", { archivedAt: "2026-08-18T00:00:00.000Z" });
  const noQuestion = makeMistake("no-question", { questionText: " " });
  const noIdea = makeMistake("no-idea", { correctIdea: null });
  const unknownCause = makeMistake("unknown-cause", { cause: "unknown" });
  const many = Array.from({ length: 55 }, (_, index) => makeMistake(`many-${index}`));

  assert.equal(isPracticeReady(ready), true);
  assert.equal(isPracticeReady(noQuestion), false);
  assert.equal(isPracticeReady(noIdea), false);
  assert.equal(isPracticeReady(unknownCause), false);
  assert.deepEqual(
    selectMistakePracticeCandidates([ready, archived, noQuestion, noIdea, unknownCause, ...many], { pool: "mixed", count: 999, now: NOW }).length,
    50,
  );
  assert.equal(selectMistakePracticeCandidates([archived, noQuestion, noIdea, unknownCause], { pool: "mixed", count: 5, now: NOW }).length, 0);
});
