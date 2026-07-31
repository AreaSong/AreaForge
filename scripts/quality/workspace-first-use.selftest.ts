import assert from "node:assert/strict";
import {
  buildFirstUseSubjects,
  canUseTakeoverPreview,
  nextAvailableGeneratedKey,
  workspaceSetupErrorMessage,
} from "../../apps/web/lib/study/workspace-first-use";

const defaults = buildFirstUseSubjects({
  subjectKey: "advanced-math",
  subjectName: "高等数学",
  include408: true,
  takeoverSubjects: [],
});
assert.deepEqual(defaults.map((subject) => subject.stableKey), [
  "advanced-math",
  "408-data-structure",
  "408-computer-organization",
  "408-operating-system",
  "408-computer-network",
]);

const reused = buildFirstUseSubjects({
  subjectKey: "math",
  subjectName: "高等数学",
  include408: true,
  takeoverSubjects: [
    { legacyCode: "MATH" },
    { legacyCode: "DATA_STRUCTURE" },
    { legacyCode: "COMPUTER_NETWORK" },
  ],
});
assert.deepEqual(reused.map((subject) => subject.stableKey), [
  "408-computer-organization",
  "408-operating-system",
]);

const customMath = buildFirstUseSubjects({
  subjectKey: "calculus",
  subjectName: "高等数学",
  include408: false,
  takeoverSubjects: [{ legacyCode: "MATH" }],
});
assert.deepEqual(customMath.map((subject) => subject.stableKey), ["calculus"]);
assert.match(workspaceSetupErrorMessage("SUBJECT_STABLE_KEY_CONFLICT_WITH_TAKEOVER"), /重复/);
assert.equal(canUseTakeoverPreview(null), false);
assert.equal(canUseTakeoverPreview({ eligibleCount: 0 }), true);
assert.equal(nextAvailableGeneratedKey("subject", ["subject-2", "subject-3"]), "subject-1");
assert.equal(nextAvailableGeneratedKey("subject", ["subject-1", "manual-key", "subject-3"]), "subject-2");
assert.equal(nextAvailableGeneratedKey("group", ["group-1", "group-2"]), "group-3");

console.log("workspace first-use selftest passed");
