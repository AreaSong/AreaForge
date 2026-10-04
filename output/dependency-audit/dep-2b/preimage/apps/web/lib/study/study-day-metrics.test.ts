import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getEffectiveStudyStreak,
  summarizeReviewCoverage,
  summarizeStudyContinuity,
} from "./study-day-metrics";

const now = new Date("2026-09-03T12:00:00+08:00");

function at(day: string): Date {
  return new Date(`${day}T09:00:00+08:00`);
}

test("today without activity keeps the streak that ended yesterday", () => {
  const sessions = ["2026-09-02", "2026-09-01", "2026-08-31"].map((day) => ({ startedAt: at(day) }));

  assert.equal(getEffectiveStudyStreak(sessions, new Map(), now), 3);
  assert.deepEqual(summarizeStudyContinuity(sessions, new Map(), now), {
    streakDays: 3,
    missedDays: 0,
  });
});

test("today activity joins the current streak", () => {
  const sessions = ["2026-09-03", "2026-09-02", "2026-09-01"].map((day) => ({ startedAt: at(day) }));

  assert.equal(getEffectiveStudyStreak(sessions, new Map(), now), 3);
});

test("missed days start at the first observed study fact", () => {
  const sessions = ["2026-09-02", "2026-08-30", "2026-08-28"].map((day) => ({ startedAt: at(day) }));

  assert.deepEqual(summarizeStudyContinuity(sessions, new Map(), now), {
    streakDays: 1,
    missedDays: 3,
  });
});

test("empty history does not fabricate seven missed days", () => {
  assert.deepEqual(summarizeStudyContinuity([], new Map(), now), {
    streakDays: 0,
    missedDays: 0,
  });
});

test("a persisted snapshot is authoritative over raw sessions", () => {
  const sessions = [{ startedAt: at("2026-09-02") }, { startedAt: at("2026-09-01") }];
  const snapshots = new Map([
    ["2026-09-02", { effectiveMinutes: 0 }],
    ["2026-09-01", { effectiveMinutes: 30 }],
  ]);

  assert.equal(getEffectiveStudyStreak(sessions, snapshots, now), 0);
});

test("review coverage stays unknown until an observed day has ended", () => {
  assert.deepEqual(summarizeReviewCoverage([
    { studyDate: "2026-09-03", totalMinutes: 30, taskCount: 1, reviewSubmitted: false },
  ], now), { completionRate: null, sampleDays: 0 });
});

test("review coverage excludes pre-history blanks and includes completed observed days", () => {
  assert.deepEqual(summarizeReviewCoverage([
    { studyDate: "2026-08-30", totalMinutes: 0, taskCount: 0, reviewSubmitted: false },
    { studyDate: "2026-08-31", totalMinutes: 45, taskCount: 1, reviewSubmitted: true },
    { studyDate: "2026-09-01", totalMinutes: 0, taskCount: 0, reviewSubmitted: false },
    { studyDate: "2026-09-02", totalMinutes: 30, taskCount: 0, reviewSubmitted: false },
    { studyDate: "2026-09-03", totalMinutes: 20, taskCount: 0, reviewSubmitted: true },
  ], now), { completionRate: 0.5, sampleDays: 4 });
});
