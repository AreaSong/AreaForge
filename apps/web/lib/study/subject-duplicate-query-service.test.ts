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
    referenceIdentities: [],
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

test("预览在构图前排除归档历史，不让归档节点桥接活动科目", async (t) => {
  const fixtureEnv = { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/unused", AUTH_SESSION_SECRET: "synthetic-test-secret-never-used-32-characters", AUTH_RBAC_ENABLED: "false", AUTH_WORKSPACES_ENABLED: "false" };
  for (const [key, value] of Object.entries(fixtureEnv)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const { listSubjectDuplicatePreviewsWithClient } = await import("./subject-duplicate-query-service");
  const countKeys = ["tasks", "sessions", "syllabusNodes", "notes", "mistakes", "simulationSubjectResults", "planMilestones", "studyResources", "primaryKnowledgePoints", "relatedKnowledgePoints", "knowledgeGroups", "learningArrangements"];
  const subject = (id: string, name: string, stableKey: string, archived = false) => ({
    id, name, stableKey, workspaceId: "workspace", groupId: null, legacyCode: null,
    archivedAt: archived ? new Date() : null, createdAt: new Date(0), sortOrder: 1, color: "#ffffff",
    _count: Object.fromEntries(countKeys.map(key => [key, 0])),
  });
  for (const [rows, expected] of [
    [[subject("a", "数学", "a"), subject("b", "数学", "b", true), subject("c", "数学", "c")], [["a", "c"]]],
    [[subject("a", "数学", "a"), subject("b", "数学", "c", true), subject("c", "物理", "c")], []],
    [[subject("a", "数学", "a", true), subject("b", "数学", "b", true)], []],
  ] as const) {
    const db = {
      examWorkspace: { findFirst: async () => ({ id: "workspace", revision: 1 }) },
      subject: { findMany: async ({ where }: { where: { archivedAt?: null } }) => rows.filter(row => where.archivedAt !== null || row.archivedAt === null) },
      ...Object.fromEntries(["studyTask", "studySession", "planInboxItem", "syllabusNode", "simulationSubjectResult", "knowledgePointSubject", "knowledgePoint", "note", "mistake", "planMilestone", "studyResource", "knowledgeGroup", "learningArrangement"].map(model => [model, { findMany: async () => [], count: async () => 0 }])),
    } as unknown as Parameters<typeof listSubjectDuplicatePreviewsWithClient>[2];
    const previews = await listSubjectDuplicatePreviewsWithClient("actor", "workspace", db);
    assert.deepEqual(previews.map(set => set.subjects.map(row => row.subject.id)), expected);
  }
});

test("多人模拟补救冲突遵循工作区和 owner 唯一约束，不跨成员误报", () => {
  const row = { subjectId: "source", originKey: "old", originVersion: 1, originSnapshot: { examId: "e", reason: "METHOD_ERROR" }, workspaceId: "w" };
  assert.deepEqual(summarizeSimulationInboxMergeConflicts([{ ...row, ownerUserId: "a" }, { ...row, ownerUserId: "b" }], "target"), { collisions: 0, invalid: 0 });
  assert.deepEqual(summarizeSimulationInboxMergeConflicts([{ ...row, ownerUserId: "a" }, { ...row, ownerUserId: "a" }], "target"), { collisions: 1, invalid: 0 });
});

test("管理员预览完整计数并提前显示其他成员活动阻断，响应不泄露私有明细", async (t) => {
  const env = { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/unused", AUTH_SESSION_SECRET: "synthetic-test-secret-never-used-32-characters", AUTH_RBAC_ENABLED: "false", AUTH_WORKSPACES_ENABLED: "false" };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const { listSubjectDuplicatePreviewsWithClient } = await import("./subject-duplicate-query-service");
  const keys = ["tasks", "sessions", "syllabusNodes", "notes", "mistakes", "simulationSubjectResults", "planMilestones", "studyResources", "primaryKnowledgePoints", "relatedKnowledgePoints", "knowledgeGroups", "learningArrangements"];
  const models = ["studyTask", "studySession", "syllabusNode", "note", "mistake", "simulationSubjectResult", "planMilestone", "planInboxItem", "studyResource", "knowledgePoint", "knowledgePointSubject", "knowledgeGroup", "learningArrangement"];
  const db = {
    examWorkspace: { findFirst: async () => ({ id: "w", revision: 1 }) },
    subject: { findMany: async (input: { include: { _count: { select: Record<string, unknown> } } }) => {
      for (const key of keys) assert.equal(input.include._count.select[key], true);
      return ["a", "b"].map(id => ({ id, workspaceId: "w", name: "数学", stableKey: id, legacyCode: null, groupId: null, archivedAt: null, color: "#ffffff", sortOrder: 1,
        _count: Object.fromEntries(keys.map(key => [key, id === "b" && ["sessions", "notes"].includes(key) ? 1 : 0])) }));
    } },
    ...Object.fromEntries(models.map(model => [model, { count: async () => 0, findMany: async (input: { where: unknown }) => {
      assert.ok(!JSON.stringify(input.where).includes("actor"));
      if (model === "note") return [{ id: "private-note", subjectId: "b", ownerUserId: "other", title: "secret-title", revision: 1 }];
      if (model === "studySession") return [{ id: "private-session", subjectId: "b", userId: "other", status: "RUNNING" }];
      return [];
    } }])),
  } as unknown as Parameters<typeof listSubjectDuplicatePreviewsWithClient>[2];
  const [preview] = await listSubjectDuplicatePreviewsWithClient("actor", "w", db);
  assert.equal(preview.totalReferenceCount, 2);
  assert.equal(preview.subjects.find(row => row.subject.id === "b")?.references.activeSessions, 1);
  assert.deepEqual(preview.privateReferenceCounts, { notes: 1, sessions: 1 });
  assert.deepEqual(preview.referenceDetails, []);
  assert.doesNotMatch(JSON.stringify(preview), /private-note|private-session|secret-title/);
});
