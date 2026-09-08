import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function routeSource(relativePath: string): Promise<string> {
  return readFile(path.join(webRoot, relativePath), "utf8");
}

test("system update routes require platform operator authorization", async () => {
  const [requests, status, operations] = await Promise.all([
    routeSource("app/api/system/update-requests/route.ts"),
    routeSource("app/api/system/update-status/route.ts"),
    routeSource("app/api/system/operations/route.ts"),
  ]);
  assert.match(requests, /requireApiUser\(request\)/);
  assert.match(requests, /requirePlatformOperator\(user, \{ fresh: true \}\)/);
  assert.match(status, /requireApiUser\(request\)/);
  assert.match(status, /requirePlatformOperator\(actor\)/);
  assert.match(operations, /requireApiUser\(request\)/);
  assert.match(operations, /requirePlatformOperator\(actor\)/);
  assert.doesNotMatch(operations, /createUpdateRequest|exec|spawn|shell|docker/i);
});

test("operator account routes derive the actor from the session and keep mutations strict", async () => {
  const [collection, statusMutation, sessionMutation, service] = await Promise.all([
    routeSource("app/api/system/accounts/route.ts"),
    routeSource("app/api/system/accounts/[userId]/status/route.ts"),
    routeSource("app/api/system/accounts/[userId]/sessions/revoke/route.ts"),
    routeSource("lib/system/account-management-service.ts"),
  ]);

  for (const source of [collection, statusMutation, sessionMutation]) {
    assert.match(source, /requireApiUser\(request\)/);
    assert.doesNotMatch(source, /actorId\s*:/);
  }
  assert.match(statusMutation, /z\.object\([\s\S]*?\)\.strict\(\)/);
  assert.match(statusMutation, /expectedAuthRevision/);
  assert.match(sessionMutation, /z\.object\([\s\S]*?\)\.strict\(\)/);
  assert.match(service, /requireRbacFeature\(\)/);
  assert.match(service, /requireFreshAccountSession\(tx, actor\)/);
  assert.match(service, /requireConfiguredOperator\(actor\)/);
});
