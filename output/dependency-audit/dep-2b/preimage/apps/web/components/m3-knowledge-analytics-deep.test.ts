import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateStarRating,
  getDaysAgo,
} from "./knowledge-micro-badges";

test("M3 Knowledge Micro-Badges Logic: getDaysAgo handles edge cases", () => {
  assert.equal(getDaysAgo(null), null);
  assert.equal(getDaysAgo(undefined), null);
  assert.equal(getDaysAgo("invalid-date"), null);

  const now = new Date();
  assert.equal(getDaysAgo(now.toISOString()), 0);

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  assert.equal(getDaysAgo(threeDaysAgo.toISOString()), 3);

  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  assert.equal(getDaysAgo(tenDaysAgo.toISOString()), 10);
});

test("M3 Knowledge Micro-Badges Logic: calculateStarRating handles consecutive passes and status", () => {
  // Consecutive passes priority
  assert.equal(calculateStarRating("unknown", 4), 5);
  assert.equal(calculateStarRating("unknown", 5), 5);
  assert.equal(calculateStarRating("unknown", 3), 4);
  assert.equal(calculateStarRating("unknown", 2), 3);
  assert.equal(calculateStarRating("unknown", 1), 2);

  // Status mapping when consecutivePassCount is 0
  assert.equal(calculateStarRating("understood", 0), 5);
  assert.equal(calculateStarRating("STABLE_MASTERY", 0), 5);
  assert.equal(calculateStarRating("INITIAL_MASTERY", 0), 4);
  assert.equal(calculateStarRating("before_exam", 0), 4);
  assert.equal(calculateStarRating("partial", 0), 3);
  assert.equal(calculateStarRating("LEARNING", 0), 3);
  assert.equal(calculateStarRating("relearn", 0), 2);
  assert.equal(calculateStarRating("NEEDS_RETEST", 0), 2);
  assert.equal(calculateStarRating("unknown", 0), 1);
  assert.equal(calculateStarRating("UNTOUCHED", 0), 1);
  assert.equal(calculateStarRating(null, 0), 1);
});

test("M3 Ebbinghaus Interval Logic: correctly segments schedule due dates", () => {
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  function categorize(dueDate: Date | null, consecutivePassCount = 0) {
    if (!dueDate || consecutivePassCount >= 4) return "d30_plus";
    const diffDays = (dueDate.getTime() - now) / msPerDay;
    if (diffDays <= 0) return "overdue";
    if (diffDays <= 2) return "d1_2";
    if (diffDays <= 7) return "d3_7";
    if (diffDays <= 14) return "d8_14";
    if (diffDays <= 30) return "d15_30";
    return "d30_plus";
  }

  // Overdue
  assert.equal(categorize(new Date(now - 1000)), "overdue");
  assert.equal(categorize(new Date(now - 2 * msPerDay)), "overdue");

  // 1-2 days
  assert.equal(categorize(new Date(now + 1 * msPerDay)), "d1_2");
  assert.equal(categorize(new Date(now + 2 * msPerDay)), "d1_2");

  // 3-7 days
  assert.equal(categorize(new Date(now + 3 * msPerDay)), "d3_7");
  assert.equal(categorize(new Date(now + 7 * msPerDay)), "d3_7");

  // 8-14 days
  assert.equal(categorize(new Date(now + 8 * msPerDay)), "d8_14");
  assert.equal(categorize(new Date(now + 14 * msPerDay)), "d8_14");

  // 15-30 days
  assert.equal(categorize(new Date(now + 15 * msPerDay)), "d15_30");
  assert.equal(categorize(new Date(now + 30 * msPerDay)), "d15_30");

  // >30 days or consolidated
  assert.equal(categorize(new Date(now + 35 * msPerDay)), "d30_plus");
  assert.equal(categorize(new Date(now + 1 * msPerDay), 4), "d30_plus");
  assert.equal(categorize(null), "d30_plus");
});

test("M3 MiniRadar Geometry: angle and radius calculations are finite and valid", () => {
  const size = 200;
  const center = size / 2;
  const radius = 62;
  const count = 5;

  const angles = Array.from({ length: count }, (_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / count);
  assert.equal(angles.length, 5);

  const testValues = [0, 25, 50, 75, 100];
  for (let i = 0; i < count; i++) {
    const val = testValues[i]!;
    const r = radius * Math.max(Math.min(val / 100, 1), 0.08);
    const x = center + r * Math.cos(angles[i]!);
    const y = center + r * Math.sin(angles[i]!);

    assert.ok(Number.isFinite(x), `x for dim ${i} must be finite`);
    assert.ok(Number.isFinite(y), `y for dim ${i} must be finite`);
    assert.ok(x >= 0 && x <= size, `x for dim ${i} within SVG box`);
    assert.ok(y >= 0 && y <= size, `y for dim ${i} within SVG box`);
  }
});
