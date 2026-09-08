import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelDataLifecycleJob,
  createExportDownloadGrant,
  listDataLifecycleJobs,
  previewDataLifecycle,
  redeemExportDownloadGrant,
  requestDataLifecycleJob,
  retryDataLifecycleJob,
  revokeExportDownloadGrants,
} from "./data-lifecycle";

test("data lifecycle adapters use canonical system routes and JSON bodies", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ jobs: [] });
  };
  try {
    await listDataLifecycleJobs();
    await previewDataLifecycle("EXPORT", "ACCOUNT");
    await requestDataLifecycleJob({ kind: "EXPORT", scope: "ACCOUNT", idempotencyKey: "request-2026-09-06" });
    await cancelDataLifecycleJob("job/1", 2);
    await retryDataLifecycleJob("job-1", 3);
    await createExportDownloadGrant("job-1");
    await revokeExportDownloadGrants("job-1");
    await redeemExportDownloadGrant("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-");
    assert.equal(calls[0]?.url, "/api/system/data-jobs");
    assert.equal(calls[1]?.url, "/api/system/data-jobs/preview");
    assert.equal(calls[2]?.init?.method, "POST");
    assert.equal(calls[3]?.url, "/api/system/data-jobs/job%2F1");
    assert.equal(calls[4]?.init?.body, JSON.stringify({ action: "retry", expectedRevision: 3 }));
    assert.equal(calls[5]?.url, "/api/system/data-jobs/job-1/download-grants");
    assert.equal(calls[6]?.url, "/api/system/data-jobs/job-1/download-grants");
    assert.equal(calls[6]?.init?.method, "DELETE");
    assert.equal(calls[7]?.url, "/api/system/data-jobs/download-grants/redeem");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
