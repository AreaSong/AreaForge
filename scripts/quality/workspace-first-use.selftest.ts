import assert from "node:assert/strict";
import {
  buildFirstUseGroups,
  buildFirstUseSubjects,
  buildFirstUseSubjectsFromDraft,
  canProceedFromFirstUseGoal,
  canProceedFromFirstUseRows,
  canUseTakeoverPreview,
  hasConfiguredFirstUseSubjects,
  materializeFirstUseTemplateSelection,
  nextAvailableGeneratedKey,
  validateFirstUseRows,
  workspaceSetupErrorMessage,
} from "../../apps/web/lib/workspace/first-use";

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
assert.equal(hasConfiguredFirstUseSubjects({ subjectKey: "", subjectName: "", include408: false }), false);
assert.equal(hasConfiguredFirstUseSubjects({ subjectKey: "subject-1", subjectName: "数学分析", include408: false }), true);
assert.equal(hasConfiguredFirstUseSubjects({ subjectKey: "", subjectName: "", include408: true }), true);
assert.equal(canProceedFromFirstUseGoal({ subjectKey: "", subjectName: "", include408: false, eligibleTakeoverCount: 0 }), false);
assert.equal(canProceedFromFirstUseGoal({ subjectKey: "", subjectName: "", include408: false, eligibleTakeoverCount: 1 }), true);
assert.equal(nextAvailableGeneratedKey("subject", ["subject-2", "subject-3"]), "subject-1");
assert.equal(nextAvailableGeneratedKey("subject", ["subject-1", "manual-key", "subject-3"]), "subject-2");
assert.equal(nextAvailableGeneratedKey("group", ["group-1", "group-2"]), "group-3");

const customRows = {
  subjects: [{ id: "custom-math", stableKey: "custom-math", name: "数学分析", color: "#35d7c5", groupStableKey: null }],
  groups: [],
};
const materialized408 = materializeFirstUseTemplateSelection({
  ...customRows,
  templateId: "computer-science-408",
});
assert.equal(materialized408.groups.length, 1);
assert.equal(materialized408.subjects.length, 5);
assert.deepEqual(materialized408.subjects.map((subject) => subject.name), [
  "数学分析",
  "数据结构",
  "计算机组成原理",
  "操作系统",
  "计算机网络",
]);
const rematerialized408 = materializeFirstUseTemplateSelection({
  ...materialized408,
  templateId: "computer-science-408",
});
assert.deepEqual(rematerialized408, materialized408);

const configuredRows = buildFirstUseSubjectsFromDraft({
  subjects: materialized408.subjects,
  templateIds: ["computer-science-408"],
  takeoverSubjects: [{ legacyCode: "DATA_STRUCTURE", stableKey: "legacy-ds", name: "数据结构" }],
});
assert.equal(configuredRows.length, 4);
assert.equal(configuredRows.filter((subject) => subject.name === "操作系统").length, 1);
assert.equal(buildFirstUseSubjectsFromDraft({
  subjects: materialized408.subjects.filter((subject) => subject.name !== "操作系统"),
  templateIds: ["computer-science-408"],
  takeoverSubjects: [],
}).some((subject) => subject.name === "操作系统"), false);
assert.equal(buildFirstUseGroups({
  groups: materialized408.groups,
  subjects: materialized408.subjects,
  templateIds: ["computer-science-408"],
}).length, 1);

const sharedGroupValidation = validateFirstUseRows({
  groups: [{ id: "group", stableKey: "professional", name: "专业课" }],
  subjects: [
    { id: "one", stableKey: "one", name: "专业课一", color: "#35d7c5", groupStableKey: "professional" },
    { id: "two", stableKey: "two", name: "专业课二", color: "#3b82f6", groupStableKey: "professional" },
  ],
});
assert.equal(sharedGroupValidation.valid, true);
assert.equal(sharedGroupValidation.configuredSubjectCount, 2);
assert.equal(validateFirstUseRows({
  groups: [],
  subjects: [{ id: "partial", stableKey: "subject-1", name: "", color: "#35d7c5", groupStableKey: null }],
}).valid, false);
assert.equal(validateFirstUseRows({
  groups: [],
  subjects: [
    { id: "one", stableKey: "same", name: "科目一", color: "#35d7c5", groupStableKey: null },
    { id: "two", stableKey: "SAME", name: "科目二", color: "#3b82f6", groupStableKey: null },
  ],
}).valid, false);
assert.equal(validateFirstUseRows({ subjects: [], groups: [], templateIds: ["removed-template"] }).valid, false);
assert.equal(canProceedFromFirstUseRows({ subjects: materialized408.subjects, templateIds: [], eligibleTakeoverCount: 0 }), true);
assert.equal(canProceedFromFirstUseRows({ subjects: [], templateIds: [], eligibleTakeoverCount: 0 }), false);
assert.equal(canProceedFromFirstUseRows({ subjects: [], templateIds: ["computer-science-408"], eligibleTakeoverCount: 0 }), false);

console.log("workspace first-use selftest passed");
