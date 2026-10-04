import assert from "node:assert/strict";
import test from "node:test";
import { requestApiBlob, readApiJson } from "./client";

test("readApiJson safely treats an already-consumed body as empty", async () => {
  const response = Response.json({ value: 1 });
  assert.deepEqual(await readApiJson(response), { value: 1 });
  assert.equal(await readApiJson(response), null);
});

test("requestApiBlob returns binary content and response headers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("# tree", {
    status: 200,
    headers: {
      "Content-Type": "text/markdown",
      "Content-Disposition": "attachment; filename=tree.md",
    },
  });
  try {
    const result = await requestApiBlob("/api/learning-tree/export", { method: "POST" });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("Content-Type"), "text/markdown");
    assert.equal(result.headers.get("Content-Disposition"), "attachment; filename=tree.md");
    assert.equal(await result.blob?.text(), "# tree");
    assert.equal(result.body, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestApiBlob reads an error body once and tolerates non-JSON errors", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    Response.json({ error: "EXPORT_NOT_FOUND", conflictFields: ["exportToken"] }, { status: 404 }),
    new Response("gateway unavailable", { status: 502 }),
    new Response(null, { status: 401 }),
  ];
  globalThis.fetch = async () => responses.shift() as Response;
  try {
    const jsonError = await requestApiBlob<{ error?: string; conflictFields?: string[] }>("/api/export");
    assert.equal(jsonError.ok, false);
    assert.equal(jsonError.status, 404);
    assert.equal(jsonError.headers.get("content-type"), "application/json");
    assert.deepEqual(jsonError.body, { error: "EXPORT_NOT_FOUND", conflictFields: ["exportToken"] });
    assert.equal(jsonError.blob, null);

    const textError = await requestApiBlob("/api/export");
    assert.equal(textError.status, 502);
    assert.equal(textError.body, null);

    const emptyError = await requestApiBlob("/api/export");
    assert.equal(emptyError.status, 401);
    assert.equal(emptyError.body, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
