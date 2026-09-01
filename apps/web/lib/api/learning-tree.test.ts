import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmLearningTreeImport,
  downloadLearningTreeExport,
  getLearningTreeImport,
  previewLearningTreeExport,
  previewLearningTreeImport,
  setLearningTreeImportArchived,
} from "./learning-tree";

test("learning tree adapter owns JSON workflow paths and query encoding", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return String(input).endsWith("/api/learning-tree/export") && init?.method === "POST"
      ? new Response("# tree", { headers: { "Content-Type": "text/markdown" } })
      : Response.json({});
  };
  try {
    await previewLearningTreeImport({ markdown: "# 树" });
    await confirmLearningTreeImport({ previewToken: "token" });
    await previewLearningTreeExport({ scope: "branch", subjectKey: "math/core", rootNodeKey: "root one" });
    await getLearningTreeImport("batch/1");
    await setLearningTreeImportArchived("batch/1", true);
    await downloadLearningTreeExport({ scope: "global", exportToken: "token" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/learning-tree/imports/preview"],
    ["POST", "http://local.test/api/learning-tree/imports/confirm"],
    ["GET", "http://local.test/api/learning-tree/export?scope=branch&preview=1&subjectKey=math%2Fcore&rootNodeKey=root+one"],
    ["GET", "http://local.test/api/learning-tree/imports/batch%2F1"],
    ["PATCH", "http://local.test/api/learning-tree/imports/batch%2F1"],
    ["POST", "http://local.test/api/learning-tree/export"],
  ]);
  assert.equal(requests[4]?.headers.get("Content-Type"), "application/json");
  assert.equal(requests[5]?.headers.get("Content-Type"), "application/json");
});

test("learning tree adapter preserves confirm conflict metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: "IMPORT_CONFLICT",
    latest: { state: "CONFLICT" },
    conflictFields: ["confirmState"],
    workbench: "/knowledge/imports",
  }, { status: 409 });
  try {
    const result = await confirmLearningTreeImport({ previewToken: "token" });
    assert.equal(result.status, 409);
    assert.deepEqual(result.body?.conflictFields, ["confirmState"]);
    assert.equal(result.body?.workbench, "/knowledge/imports");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("learning tree blob download preserves headers and parses one error body", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    new Response("# exported", {
      status: 200,
      headers: {
        "Content-Type": "text/markdown",
        "X-Export-Token": "token",
      },
    }),
    Response.json({ error: "EXPORT_NOT_FOUND", latest: { state: "EXPIRED" } }, { status: 404 }),
    new Response("not-json", { status: 502 }),
  ];
  globalThis.fetch = async () => responses.shift() as Response;
  try {
    const success = await downloadLearningTreeExport({ exportToken: "token" });
    assert.equal(success.ok, true);
    assert.equal(success.status, 200);
    assert.equal(success.headers.get("X-Export-Token"), "token");
    assert.equal(await success.blob?.text(), "# exported");
    assert.equal(success.error, null);

    const jsonError = await downloadLearningTreeExport({ exportToken: "token" });
    assert.equal(jsonError.ok, false);
    assert.equal(jsonError.status, 404);
    assert.equal(jsonError.headers.get("content-type"), "application/json");
    assert.equal(jsonError.error?.error, "EXPORT_NOT_FOUND");
    assert.deepEqual(jsonError.error?.latest, { state: "EXPIRED" });

    const nonJsonError = await downloadLearningTreeExport({ exportToken: "token" });
    assert.equal(nonJsonError.status, 502);
    assert.equal(nonJsonError.error, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
