import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function routeSource(relativePath: string): Promise<string> {
  return readFile(path.join(webRoot, relativePath), "utf8");
}

test("data job routes derive actor from session and use strict schemas", async () => {
  const paths = [
    "app/api/system/data-jobs/route.ts",
    "app/api/system/data-jobs/preview/route.ts",
    "app/api/system/data-jobs/[jobId]/route.ts",
    "app/api/system/data-jobs/[jobId]/download-grants/route.ts",
    "app/api/system/data-jobs/download-grants/redeem/route.ts",
  ];
  const sources = await Promise.all(paths.map(routeSource));
  for (const source of sources) {
    assert.match(source, /requireApiUser\(request\)/);
    assert.doesNotMatch(source, /actorId\s*:/);
  }
  assert.match(sources[0]!, /z\.object\([\s\S]*?\)\.strict\(\)/);
  assert.match(sources[1]!, /requireRecentReauthentication\(actor\)/);
  assert.match(sources[2]!, /expectedRevision/);
  assert.match(sources[3]!, /createExportDownloadGrant/);
  assert.match(sources[4]!, /redeemExportDownloadGrant/);
});

test("worker lifecycle routes require an operator and strict lease payloads", async () => {
  const paths = [
    "app/api/system/data-jobs/worker/claim/route.ts",
    "app/api/system/data-jobs/worker/heartbeat/route.ts",
    "app/api/system/data-jobs/worker/complete/route.ts",
    "app/api/system/data-jobs/worker/expire/route.ts",
  ];
  const sources = await Promise.all(paths.map(routeSource));
  for (const source of sources) {
    assert.match(source, /requireApiUser\(request\)/);
    assert.match(source, /requirePlatformOperator\(actor\)/);
    assert.match(source, /\.strict\(\)/);
    assert.doesNotMatch(source, /actorId\s*:/);
  }
  assert.match(sources[0]!, /claimDataLifecycleJob/);
  assert.match(sources[1]!, /heartbeatDataLifecycleJob/);
  assert.match(sources[2]!, /completeDataLifecycleJob/);
  assert.match(sources[3]!, /expireDataLifecycleJob/);
});

test("data lifecycle service has no physical deletion or archive filesystem path", async () => {
  const service = await routeSource("lib/system/data-lifecycle-service.ts");
  assert.doesNotMatch(service, /prisma\.[A-Za-z]+\.(delete|deleteMany)\s*\(/);
  assert.doesNotMatch(service, /from ["']node:(fs|fs\/promises)["']/);
  assert.match(service, /physicalDeletionSupported:\s*false/);
  assert.match(service, /archiveStatus:\s*"NOT_WRITTEN"/);
  assert.match(service, /hashDataDownloadToken/);
  assert.doesNotMatch(service, /return\s+\{[^}]*objectKey/);
});

test("data inventory includes recipient-scoped notifications without internal event keys", async () => {
  const service = await routeSource("lib/system/data-lifecycle-service.ts");
  assert.match(service, /"userNotification", "userNotification"/);
  assert.match(service, /recipientUserId: actorId/);
  assert.doesNotMatch(service, /userNotification[\s\S]{0,500}sourceEntityId: true/);
  assert.doesNotMatch(service, /userNotification[\s\S]{0,500}eventKey: true/);
});

test("download grant route never accepts a raw path or token hash", async () => {
  const source = await routeSource("app/api/system/data-jobs/[jobId]/download-grants/route.ts");
  assert.doesNotMatch(source, /objectKey|tokenHash|storedName|uri/i);
  assert.match(source, /requireRecentReauthentication\(actor\)/);
});
