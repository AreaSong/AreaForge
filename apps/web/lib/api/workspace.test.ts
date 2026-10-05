import assert from "node:assert/strict";
import test from "node:test";
import {
  activateExamWorkspace,
  createExamWorkspace,
  createSubjectGroup,
  createWorkspaceSubject,
  confirmSubjectMerge,
  readWorkspaceConflictRevision,
  updateExamWorkspace,
  updateSubjectGroup,
  updateWorkspaceSubject,
} from "./workspace";

test("workspace adapters own encoded paths and revision-bearing JSON commands", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ workspace: { id: "workspace-1", revision: 3 } });
  };

  try {
    await createExamWorkspace({
      stableKey: "primary",
      name: "主工作区",
      activate: true,
      groups: [{ stableKey: "professional", name: "专业课", sortOrder: 10 }],
      subjects: [{ stableKey: "subject-one", name: "专业课一", color: "#35d7c5", groupStableKey: "professional" }],
    });
    await updateExamWorkspace("workspace/1", { expectedRevision: 2, name: "新名称" });
    await activateExamWorkspace("workspace/1", 2);
    await createWorkspaceSubject("workspace/1", {
      stableKey: "math",
      name: "数学",
      color: "#35d7c5",
      expectedWorkspaceRevision: 2,
    });
    await updateWorkspaceSubject("workspace/1", "subject/1", {
      expectedWorkspaceRevision: 2,
      move: "UP",
    });
    await createSubjectGroup("workspace/1", {
      expectedWorkspaceRevision: 2,
      stableKey: "public",
      name: "公共课",
    });
    await updateSubjectGroup("workspace/1", "group/1", {
      expectedWorkspaceRevision: 2,
      archived: true,
    });
    await confirmSubjectMerge("workspace/1", {
      targetSubjectId: "subject-target",
      sourceSubjectIds: ["subject-source"],
      snapshotHash: "sha256:" + "a".repeat(64),
      expectedWorkspaceRevision: 2,
      idempotencyKey: "subject-merge-command-1",
      confirm: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/exam-workspaces"],
    ["PATCH", "http://local.test/api/exam-workspaces/workspace%2F1"],
    ["POST", "http://local.test/api/exam-workspaces/workspace%2F1/activate"],
    ["POST", "http://local.test/api/exam-workspaces/workspace%2F1/subjects"],
    ["PATCH", "http://local.test/api/exam-workspaces/workspace%2F1/subjects/subject%2F1"],
    ["POST", "http://local.test/api/exam-workspaces/workspace%2F1/subject-groups"],
    ["PATCH", "http://local.test/api/exam-workspaces/workspace%2F1/subject-groups/group%2F1"],
    ["POST", "http://local.test/api/exam-workspaces/workspace%2F1/subject-merges"],
  ]);
  assert.equal(requests.every((request) => request.headers.get("Content-Type") === "application/json"), true);
  assert.deepEqual(await requests[0]!.json(), {
    stableKey: "primary",
    name: "主工作区",
    activate: true,
    groups: [{ stableKey: "professional", name: "专业课", sortOrder: 10 }],
    subjects: [{ stableKey: "subject-one", name: "专业课一", color: "#35d7c5", groupStableKey: "professional" }],
  });
  assert.deepEqual(await requests[2]!.json(), { expectedRevision: 2 });
  assert.deepEqual(await requests[4]!.json(), { expectedWorkspaceRevision: 2, move: "UP" });
  assert.deepEqual(await requests[7]!.json(), {
    targetSubjectId: "subject-target",
    sourceSubjectIds: ["subject-source"],
    snapshotHash: "sha256:" + "a".repeat(64),
    expectedWorkspaceRevision: 2,
    idempotencyKey: "subject-merge-command-1",
    confirm: true,
  });
});

test("合并预览冲突后仍可用整数版本继续普通科目操作", async () => {
  const originalFetch = globalThis.fetch;
  const revisions: unknown[] = [];
  let request = 0;
  globalThis.fetch = async (_url, init) => {
    request++;
    if (request === 1) return Response.json({ error: "SUBJECT_MERGE_SNAPSHOT_CONFLICT", latest: { workspaceRevision: 7, snapshotHash: "new" } }, { status: 409 });
    revisions.push(JSON.parse(String(init?.body)).expectedWorkspaceRevision);
    return Response.json({ workspace: { revision: 8 } });
  };
  try {
    const result = await confirmSubjectMerge("w", { targetSubjectId: "a", sourceSubjectIds: ["b"], snapshotHash: "old", expectedWorkspaceRevision: 7, idempotencyKey: "command-1", confirm: true });
    const revision = readWorkspaceConflictRevision(result.body);
    assert.equal(revision, 7);
    await createWorkspaceSubject("w", { stableKey: "new", name: "新科目", color: "#ffffff", expectedWorkspaceRevision: revision! });
    assert.deepEqual(revisions, [7]);
  } finally { globalThis.fetch = originalFetch; }
});

test("坏冲突回执不能进入本地版本状态", () => {
  for (const value of [undefined, null, NaN, Infinity, -1, 1.5, "7", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(readWorkspaceConflictRevision({ latest: { revision: value } }), null);
    assert.equal(readWorkspaceConflictRevision({ latest: { workspaceRevision: value } }), null);
  }
  assert.equal(readWorkspaceConflictRevision({ latest: { revision: 3 } }), 3);
  assert.equal(readWorkspaceConflictRevision({ latest: {} }), null);
});
