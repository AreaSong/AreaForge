import assert from "node:assert/strict";
import test from "node:test";
import { getStudyWeekRange } from "./date";

test("study week uses Shanghai Monday through Sunday across UTC boundaries", () => {
  const mondayMorning = getStudyWeekRange(new Date("2026-08-31T00:30:00+08:00"));
  assert.equal(mondayMorning.key, "2026-08-31");
  assert.equal(mondayMorning.start.toISOString(), "2026-08-30T16:00:00.000Z");
  assert.equal(mondayMorning.end.toISOString(), "2026-09-06T16:00:00.000Z");

  const sundayNight = getStudyWeekRange(new Date("2026-09-06T23:59:59+08:00"));
  assert.equal(sundayNight.key, "2026-08-31");
  assert.equal(sundayNight.start.toISOString(), mondayMorning.start.toISOString());
});

test("study week rolls over at Shanghai midnight on Monday", () => {
  const before = getStudyWeekRange(new Date("2026-09-06T23:59:59+08:00"));
  const after = getStudyWeekRange(new Date("2026-09-07T00:00:00+08:00"));
  assert.equal(before.key, "2026-08-31");
  assert.equal(after.key, "2026-09-07");
});
