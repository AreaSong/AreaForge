import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const componentPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "data-job-center-client.tsx");
const pagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/(app)/settings/data/page.tsx");

test("data job center is feature-gated and exposes the complete safe lifecycle surface", async () => {
  const [component, page] = await Promise.all([
    readFile(componentPath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  assert.match(component, /props\.enabled/);
  for (const symbol of [
    "previewDataLifecycle",
    "requestDataLifecycleJob",
    "cancelDataLifecycleJob",
    "retryDataLifecycleJob",
    "createExportDownloadGrant",
    "revokeExportDownloadGrants",
    "redeemExportDownloadGrant",
    "pauseDataLifecycleJob",
    "resumeDataLifecycleJob",
  ]) assert.match(component, new RegExp(symbol));
  assert.match(page, /DATA_LIFECYCLE_ENABLED/);
  assert.match(component, /不会物理删除/);
  assert.match(component, /归档由独立 worker 写入/);
  assert.match(component, /不执行服务器命令/);
  assert.match(component, /createLatestOperationGate/);
  assert.match(component, /createExclusiveOperationGate/);
  assert.match(component, /requestIdentity\.current/);
  assert.match(component, /job\.downloadable === true/);
  assert.doesNotMatch(component, /clipboard|value=\{[^}]*grant[^}]*token|任务状态未改变/);
  assert.match(component, /redeemExportDownloadGrant\(issued\.body\.grant\.token/);
  assert.match(page, /DATA_EXPORT_ENABLED/);
  assert.doesNotMatch(component, /\bfetch\s*\(/);
  assert.doesNotMatch(component, /<button\b|<input\b|<select\b|<textarea\b/);
});
