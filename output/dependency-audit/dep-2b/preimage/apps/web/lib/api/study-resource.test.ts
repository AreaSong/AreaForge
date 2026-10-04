import assert from "node:assert/strict";
import test from "node:test";
import {
  createLinkStudyResource,
  setStudyResourceArchiveState,
  updateStudyResource,
} from "./study-resource";

test("study resource adapter owns metadata lifecycle endpoints", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ resource: { id: "resource-1" } });
  };
  try {
    await updateStudyResource("resource/1", { expectedRevision: 1 });
    await setStudyResourceArchiveState("resource/1", "archive", 2);
    await setStudyResourceArchiveState("resource/1", "restore", 3);
    await createLinkStudyResource({ title: "链接", url: "https://example.com" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["PATCH", "http://local.test/api/study-resources/resource%2F1"],
    ["POST", "http://local.test/api/study-resources/resource%2F1/archive"],
    ["POST", "http://local.test/api/study-resources/resource%2F1/restore"],
    ["POST", "http://local.test/api/study-resources/links"],
  ]);
});

test("study resource adapter preserves revision conflicts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: "REVISION_CONFLICT",
    latest: { id: "resource-1", revision: 4 },
    conflictFields: ["revision"],
  }, { status: 409 });
  try {
    const result = await updateStudyResource("resource-1", { expectedRevision: 3 });
    assert.equal(result.status, 409);
    assert.equal(result.body?.latest?.revision, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
