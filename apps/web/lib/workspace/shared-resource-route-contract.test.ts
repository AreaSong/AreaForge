import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("shared resource detail keeps authentication, type allowlisting and storage redaction explicit", async () => {
  const [route, service] = await Promise.all([
    readFile(path.join(webRoot, "app/api/shared-resources/[resourceType]/[id]/route.ts"), "utf8"),
    readFile(path.join(webRoot, "lib/workspace/shared-resource-service.ts"), "utf8"),
  ]);

  assert.match(route, /requireApiUser\(request\)/);
  assert.match(route, /resourceType !== "NOTE"/);
  assert.match(route, /resourceType !== "MISTAKE"/);
  assert.match(route, /resourceType !== "ATTACHMENT"/);
  assert.doesNotMatch(route, /actorId\s*:/);
  assert.match(service, /requireSharedResourceAccess/);
  assert.match(service, /WORKSPACE_SHARED_RESOURCE_READ/);
  assert.doesNotMatch(service, /\buri\b/);
  assert.doesNotMatch(service, /storedName/);
  assert.doesNotMatch(service, /absolutePath/);
});
