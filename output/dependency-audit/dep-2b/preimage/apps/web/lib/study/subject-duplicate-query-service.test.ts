import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSubjectDuplicateSnapshotHash,
  countCrossSubjectKeys,
  summarizeSimulationInboxMergeConflicts,
} from "./subject-duplicate-query-service";

test("countCrossSubjectKeys counts a key once when it appears across subjects", () => {
  assert.equal(countCrossSubjectKeys([
    { subjectId: "a", key: "same" },
    { subjectId: "a", key: "same" },
    { subjectId: "b", key: "same" },
    { subjectId: "b", key: "other" },
  ], (row) => row.key), 1);
});

test("countCrossSubjectKeys ignores repeats inside one subject and empty keys", () => {
  assert.equal(countCrossSubjectKeys([
    { subjectId: "a", key: "same" },
    { subjectId: "a", key: "same" },
    { subjectId: "b", key: "" },
  ], (row) => row.key), 0);
});

test("buildSubjectDuplicateSnapshotHash is stable and binds the workspace and merge scope", () => {
  const base = {
    workspaceId: "workspace-a",
    workspaceRevision: 4,
    targetId: "subject-a",
    sourceIds: ["subject-b", "subject-c"],
    reasons: [{ code: "NORMALIZED_NAME" as const, normalizedValue: "数学", subjectIds: ["subject-a", "subject-b"] }],
    subjects: [],
    conflictCounts: {
      syllabusStableKeys: 0,
      simulationExams: 1,
      simulationInboxOrigins: 0,
      invalidSimulationInboxOrigins: 0,
      relatedKnowledgePoints: 0,
    },
    simulationOriginInboxItems: 0,
    primaryKnowledgePoints: 2,
  };
  const first = buildSubjectDuplicateSnapshotHash(base);
  const reordered = buildSubjectDuplicateSnapshotHash({ ...base, sourceIds: ["subject-c", "subject-b"] });
  const otherWorkspace = buildSubjectDuplicateSnapshotHash({ ...base, workspaceId: "workspace-b" });
  const changedReferenceState = buildSubjectDuplicateSnapshotHash({
    ...base,
    subjects: [{
      subject: {
        id: "subject-a", workspaceId: "workspace-a", groupId: null, stableKey: "math", legacyCode: null,
        name: "数学", color: "#38bdf8", sortOrder: 10, archivedAt: null, legacyScope: false,
      },
      references: {
        tasks: 1, sessions: 0, activeSessions: 0, syllabusNodes: 0, notes: 0, mistakes: 0,
        simulationSubjectResults: 0, planMilestones: 0, planInboxItems: 0, studyResources: 0,
        primaryKnowledgePoints: 0, relatedKnowledgePoints: 0, knowledgeGroups: 0, learningArrangements: 0, total: 1,
      },
    }],
  });

  assert.equal(first, reordered);
  assert.match(first, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(first, otherWorkspace);
  assert.notEqual(first, changedReferenceState);
});

test("summarizeSimulationInboxMergeConflicts detects remapped unique collisions and invalid snapshots", () => {
  const result = summarizeSimulationInboxMergeConflicts([
    {
      subjectId: "target",
      originKey: "simulation-loss:exam-1:target:METHOD_ERROR:none",
      originVersion: 1,
      originSnapshot: {},
    },
    {
      subjectId: "source",
      originKey: "old-key",
      originVersion: 1,
      originSnapshot: { examId: "exam-1", reason: "METHOD_ERROR", syllabusNodeId: null },
    },
    {
      subjectId: "source",
      originKey: "invalid-key",
      originVersion: 1,
      originSnapshot: { examId: "exam-2", reason: "NOT_A_REASON" },
    },
  ], "target");

  assert.deepEqual(result, { collisions: 1, invalid: 1 });
});
