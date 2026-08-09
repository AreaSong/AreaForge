import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getStudySessionStartTimeError,
  SESSION_START_FUTURE_SKEW_MS,
  SESSION_START_MAX_AGE_MS,
} from "@/lib/study/session-time";

const now = new Date("2026-08-04T00:00:00.000Z");

test("session start accepts normal and delayed offline timestamps", () => {
  assert.equal(getStudySessionStartTimeError(new Date(now.getTime()), now), null);
  assert.equal(getStudySessionStartTimeError(new Date(now.getTime() - SESSION_START_MAX_AGE_MS), now), null);
  assert.equal(getStudySessionStartTimeError(new Date(now.getTime() + SESSION_START_FUTURE_SKEW_MS), now), null);
});

test("session start rejects future timestamps beyond clock skew", () => {
  assert.equal(getStudySessionStartTimeError(new Date(now.getTime() + SESSION_START_FUTURE_SKEW_MS + 1), now), "future");
});

test("session start rejects timestamps older than the offline retention window", () => {
  assert.equal(getStudySessionStartTimeError(new Date(now.getTime() - SESSION_START_MAX_AGE_MS - 1), now), "too_old");
});
