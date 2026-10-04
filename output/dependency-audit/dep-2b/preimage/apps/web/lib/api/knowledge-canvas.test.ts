import assert from "node:assert/strict";
import test from "node:test";
import {
  loadKnowledgeCanvas,
  resetKnowledgeCanvasLayout,
  saveKnowledgeCanvasLayout,
} from "@/lib/api/knowledge-canvas";

test("knowledge canvas adapter owns query encoding and preserves CAS mutation status", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json(
      { error: "LAYOUT_REVISION_CONFLICT", latest: { revision: 4 }, conflictFields: ["revision"] },
      { status: 409 },
    );
  };
  try {
    const query = await loadKnowledgeCanvas({
      workspaceId: "workspace/one",
      depth: 2,
      focus: "NOTE:one/two",
      cursor: "NOTE:cursor",
      q: "线性 代数",
      entityType: "NOTE",
      subjectId: "subject-1",
      status: "all",
    });
    const save = await saveKnowledgeCanvasLayout({
      workspaceId: "workspace/one",
      expectedRevision: 3,
      viewportX: 1,
      viewportY: 2,
      viewportZoom: 1.5,
      nodes: [],
    });
    const reset = await resetKnowledgeCanvasLayout({
      workspaceId: "workspace/one",
      expectedRevision: 4,
    });
    assert.deepEqual(
      [query, save, reset].map((result) => [result.ok, result.status, result.body?.error]),
      Array.from({ length: 3 }, () => [false, 409, "LAYOUT_REVISION_CONFLICT"]),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const queryUrl = new URL(requests[0]!.url);
  assert.equal(requests[0]?.method, "GET");
  assert.equal(queryUrl.pathname, "/api/knowledge-canvas");
  assert.deepEqual(Object.fromEntries(queryUrl.searchParams), {
    workspaceId: "workspace/one",
    depth: "2",
    status: "all",
    focus: "NOTE:one/two",
    cursor: "NOTE:cursor",
    q: "线性 代数",
    entityType: "NOTE",
    subjectId: "subject-1",
  });
  assert.deepEqual(requests.slice(1).map((request) => request.method), ["PUT", "DELETE"]);
  assert.equal(requests[1]?.headers.get("Content-Type"), "application/json");
  assert.deepEqual(await requests[1]?.json(), {
    workspaceId: "workspace/one",
    expectedRevision: 3,
    viewportX: 1,
    viewportY: 2,
    viewportZoom: 1.5,
    nodes: [],
  });
  assert.deepEqual(await requests[2]?.json(), {
    workspaceId: "workspace/one",
    expectedRevision: 4,
  });
});
