import assert from "node:assert/strict";
import test from "node:test";
import {
  activateExamWorkspace,
  createExamWorkspace,
  createSubjectGroup,
  createWorkspaceSubject,
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
});
