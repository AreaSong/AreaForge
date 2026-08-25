import assert from "node:assert/strict";
import test from "node:test";
import { readAppShellStatus } from "./app-shell";

test("app shell adapter owns the status query and forwards device headers", async () => {
  let capturedRequest: Request | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    capturedRequest = new Request(new URL(String(input), "http://local.test"), init);
    return Response.json({ status: { activeSession: null } });
  };
  try {
    const result = await readAppShellStatus({ "x-areaforge-device-id": "device-1" });
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const request = capturedRequest as Request | null;
  assert.ok(request);
  assert.equal(request.method, "GET");
  assert.equal(request.url, "http://local.test/api/app-shell/status");
  assert.equal(request.headers.get("x-areaforge-device-id"), "device-1");
});
