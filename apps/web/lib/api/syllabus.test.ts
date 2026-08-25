import assert from "node:assert/strict";
import test from "node:test";
import {
  addSyllabusMasteryEvidence,
  addSyllabusMasteryRetest,
  createSyllabusNode,
  importSyllabusMarkdown,
  setSyllabusNodeArchiveState,
  updateSyllabusNode,
} from "./syllabus";

test("syllabus adapter owns endpoint paths, methods, and id encoding", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ node: { id: "node-1" } });
  };
  try {
    await createSyllabusNode({ title: "节点" });
    await importSyllabusMarkdown({ markdown: "# 节点" });
    await updateSyllabusNode("node/1", { expectedRevision: 1 });
    await setSyllabusNodeArchiveState("node/1", "archive", 2);
    await addSyllabusMasteryEvidence("node/1", { evidenceType: "task" });
    await addSyllabusMasteryRetest("node/1", { result: "passed" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/syllabus/nodes"],
    ["POST", "http://local.test/api/syllabus/import-markdown"],
    ["PATCH", "http://local.test/api/syllabus/nodes/node%2F1"],
    ["POST", "http://local.test/api/syllabus/nodes/node%2F1/archive"],
    ["POST", "http://local.test/api/syllabus/nodes/node%2F1/mastery-evidence"],
    ["POST", "http://local.test/api/syllabus/nodes/node%2F1/mastery-retests"],
  ]);
  assert.equal(requests.every((request) => request.headers.get("Content-Type") === "application/json"), true);
});

test("syllabus adapter preserves conflict metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: "REVISION_CONFLICT",
    latest: { id: "node-1", revision: 3, title: "服务端" },
    conflictFields: ["title"],
  }, { status: 409 });
  try {
    const result = await updateSyllabusNode("node-1", { expectedRevision: 2 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.body?.latest?.revision, 3);
    assert.deepEqual(result.body?.conflictFields, ["title"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
