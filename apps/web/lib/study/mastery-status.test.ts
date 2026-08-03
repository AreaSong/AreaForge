import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateMasteryConfidence,
  knowledgeMasteryStatusView,
  knowledgeStateForMasteryStatus,
  syllabusLevelForMasteryStatus,
  syllabusMasteryStatusView,
} from "@/lib/study/mastery-status";

test("knowledge persistence states expose exactly four visible states", () => {
  assert.equal(knowledgeMasteryStatusView("UNTOUCHED").status, "UNTOUCHED");
  assert.equal(knowledgeMasteryStatusView("LEARNING").status, "LEARNING");
  assert.equal(knowledgeMasteryStatusView("INITIAL_MASTERY").status, "INDEPENDENT");
  assert.equal(knowledgeMasteryStatusView("STABLE_MASTERY").status, "STABLE");
  assert.equal(knowledgeMasteryStatusView("NEEDS_RETEST").status, "LEARNING");
});

test("needs retest is an overlay, not a fifth mastery state", () => {
  const now = new Date("2026-08-03T00:00:00.000Z");
  const view = knowledgeMasteryStatusView("STABLE_MASTERY", "2026-08-02T00:00:00.000Z", now);
  assert.equal(view.status, "STABLE");
  assert.equal(view.needsRetest, true);

  const syllabus = syllabusMasteryStatusView({ level: "exam_stable", proofRisk: "stale_evidence", now });
  assert.equal(syllabus.status, "STABLE");
  assert.equal(syllabus.needsRetest, true);
});

test("visible statuses map back to compatible persistence levels", () => {
  assert.equal(knowledgeStateForMasteryStatus("INDEPENDENT"), "INITIAL_MASTERY");
  assert.equal(knowledgeStateForMasteryStatus("STABLE"), "STABLE_MASTERY");
  assert.equal(syllabusLevelForMasteryStatus("UNTOUCHED"), null);
  assert.equal(syllabusLevelForMasteryStatus("STABLE"), "retest_passed");
});

test("quantitative confidence is bounded and penalizes stale evidence", () => {
  const fresh = calculateMasteryConfidence({ evidenceCount: 4, sessionCount: 2, noteCount: 1, passedRetestCount: 1, daysSinceLastEvidence: 2 });
  const stale = calculateMasteryConfidence({ evidenceCount: 4, sessionCount: 2, noteCount: 1, passedRetestCount: 1, daysSinceLastEvidence: 90 });
  assert.ok(fresh >= stale);
  assert.ok(fresh >= 0 && fresh <= 100);
  assert.ok(stale >= 0 && stale <= 100);
});
