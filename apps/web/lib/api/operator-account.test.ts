import assert from "node:assert/strict";
import test from "node:test";
import {
  listOperatorAccounts,
  revokeOperatorAccountSessions,
  updateOperatorAccountStatus,
} from "./operator-account";

test("operator account adapter keeps ids encoded and mutations reason bound", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ accounts: [] });
  };
  try {
    await listOperatorAccounts();
    await updateOperatorAccountStatus("user/1", {
      status: "SUSPENDED",
      expectedAuthRevision: 3,
      reason: "SECURITY_REVIEW",
    });
    await revokeOperatorAccountSessions("user/1", "INCIDENT_RESPONSE");
    assert.equal(calls[0]?.url, "/api/system/accounts");
    assert.equal(calls[1]?.url, "/api/system/accounts/user%2F1/status");
    assert.equal(calls[1]?.init?.method, "PATCH");
    assert.equal(calls[1]?.init?.body, JSON.stringify({
      status: "SUSPENDED",
      expectedAuthRevision: 3,
      reason: "SECURITY_REVIEW",
    }));
    assert.equal(calls[2]?.url, "/api/system/accounts/user%2F1/sessions/revoke");
    assert.equal(calls[2]?.init?.body, JSON.stringify({ reason: "INCIDENT_RESPONSE" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
