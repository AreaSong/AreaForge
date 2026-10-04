import assert from "node:assert/strict";
import test from "node:test";
import { readApiJson } from "./client";
import {
  ApiClientError,
  createJsonRequest,
  requestApi,
  requestApiJson,
  requestApiResult,
} from "./client";

test("readApiJson returns parsed JSON without assigning a business shape", async () => {
  assert.deepEqual(await readApiJson(Response.json({ value: 1 })), { value: 1 });
  assert.equal(await readApiJson(Response.json(null)), null);
});

test("readApiJson returns null when the response body is not valid JSON", async () => {
  const response = new Response("not-json", { headers: { "Content-Type": "application/json" } });
  assert.equal(await readApiJson(response), null);
});

test("requestApiJson keeps status and parsed body together", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ value: 2 }, { status: 201 });
  try {
    const result = await requestApiJson<{ value: number }>("/api/example");
    assert.equal(result.response.status, 201);
    assert.deepEqual(result.body, { value: 2 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestApiResult exposes transport metadata without the raw response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ value: 3 }, {
    status: 202,
    headers: { "x-request-id": "request-3" },
  });
  try {
    const result = await requestApiResult<{ value: number }>("/api/example");
    assert.equal(result.ok, true);
    assert.equal(result.status, 202);
    assert.equal(result.headers.get("x-request-id"), "request-3");
    assert.deepEqual(result.body, { value: 3 });
    assert.equal("response" in result, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createJsonRequest preserves headers and serializes the body", async () => {
  const init = createJsonRequest("PATCH", { revision: 2 }, {
    cache: "no-store",
    headers: { "x-idempotency-key": "command-2" },
  });
  const headers = new Headers(init.headers);
  assert.equal(init.method, "PATCH");
  assert.equal(init.cache, "no-store");
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(headers.get("x-idempotency-key"), "command-2");
  assert.equal(init.body, JSON.stringify({ revision: 2 }));
});

test("requestApi throws a typed error while preserving the server body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "REVISION_CONFLICT", latest: { revision: 3 } }, { status: 409 });
  try {
    await assert.rejects(
      () => requestApi("/api/example"),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 409
        && error.message === "REVISION_CONFLICT"
        && (error.body as { latest?: { revision: number } }).latest?.revision === 3,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
