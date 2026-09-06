import assert from "node:assert/strict";
import test from "node:test";
import {
  approveControlledOperationRequest,
  cancelControlledOperationRequest,
  confirmControlledOperationRequest,
  createControlledOperationRequest,
  getControlledOperationRequest,
  holdControlledOperationRequest,
  listControlledOperationRequests,
  listControlledOperations,
  retryControlledOperationRequest,
  resumeControlledOperationRequest,
} from "./controlled-operations";

const binding = {
  expectedRevision: 3,
  requestHash: `sha256:${"a".repeat(64)}`,
  nonce: "11111111-1111-4111-8111-111111111111",
};

test("controlled operations adapter keeps routes, methods, and binding bodies canonical", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ request: { id: "request-1" } });
  };

  try {
    await listControlledOperations();
    await listControlledOperationRequests({ status: "RUNNING", limit: 20 });
    await getControlledOperationRequest("request/1");
    await createControlledOperationRequest({
      operation: { operation: "DIAGNOSTIC_HEALTH", includeCapacity: false },
      expectedBeforeHash: binding.requestHash,
      idempotencyKey: binding.nonce,
      requestedReason: "读取脱敏健康摘要",
    });
    await confirmControlledOperationRequest("request-1", binding);
    await approveControlledOperationRequest("request-1", binding);
    await cancelControlledOperationRequest("request-1", binding);
    await holdControlledOperationRequest("request-1", { ...binding, reasonCode: "INCIDENT" });
    await resumeControlledOperationRequest("request-1", binding);
    await retryControlledOperationRequest("request-1", binding);

    assert.equal(calls[0]?.url, "/api/system/operations");
    assert.equal(calls[1]?.url, "/api/system/operations/requests?status=RUNNING&limit=20");
    assert.equal(calls[2]?.url, "/api/system/operations/requests/request%2F1");
    assert.equal(calls[3]?.init?.method, "POST");
    assert.equal(calls[3]?.init?.body, JSON.stringify({
      operation: { operation: "DIAGNOSTIC_HEALTH", includeCapacity: false },
      expectedBeforeHash: binding.requestHash,
      idempotencyKey: binding.nonce,
      requestedReason: "读取脱敏健康摘要",
    }));
    assert.equal(calls[4]?.url, "/api/system/operations/requests/request-1/confirm");
    assert.equal(calls[4]?.init?.body, JSON.stringify(binding));
    assert.equal(calls[7]?.init?.body, JSON.stringify({ ...binding, reasonCode: "INCIDENT" }));
    assert.equal(calls[9]?.url, "/api/system/operations/requests/request-1/retry");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
