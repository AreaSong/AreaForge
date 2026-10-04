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

test("真实下载使用二进制响应，旧描述信息与网络中断不可冒充成功", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const bytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
    globalThis.fetch = async () => new Response(bytes, { headers: { "content-type": "application/zip", "content-length": String(bytes.length), "content-disposition": 'attachment; filename="areaforge-account-job.zip"' } });
    const valid = await redeemExportDownloadGrant("fixture-token");
    assert.equal(valid.ok, true); assert.equal(valid.blob?.size, bytes.length); assert.equal(valid.fileName, "areaforge-account-job.zip");
    globalThis.fetch = async () => Response.json({ download: { fileName: "legacy.zip" } });
    const legacy = await redeemExportDownloadGrant("fixture-token");
    assert.equal(legacy.ok, false); assert.equal(legacy.blob, null);
    globalThis.fetch = async () => Response.json({ error: "DATA_EXPORT_DOWNLOAD_NOT_FOUND" }, { status: 404 });
    const missing = await redeemExportDownloadGrant("fixture-token");
    assert.equal(missing.status, 404); assert.equal(missing.body?.error, "DATA_EXPORT_DOWNLOAD_NOT_FOUND");
    globalThis.fetch = async () => { throw new Error("network unavailable"); };
    const network = await redeemExportDownloadGrant("fixture-token");
    assert.equal(network.ok, false); assert.equal(network.status, 0); assert.equal(network.fileName, null);
  } finally { globalThis.fetch = originalFetch; }
});

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
