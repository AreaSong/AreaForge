import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const systemRoot = path.dirname(fileURLToPath(import.meta.url));

test("workspace search authenticates and filters before returning private labels", async () => {
  const [service, route] = await Promise.all([
    readFile(path.join(systemRoot, "workspace-search-service.ts"), "utf8"),
    readFile(path.join(systemRoot, "../../app/api/search/route.ts"), "utf8"),
  ]);
  assert.match(route, /requireApiUser/);
  assert.match(route, /searchWorkspace\(actor\.id/);
  assert.match(service, /requireWorkspacePolicy/);
  assert.match(service, /grantAllowsActor/);
  assert.match(service, /filterWorkspaceSearchCandidates/);
  assert.match(service, /ownerUserId:\s*actorId/);
  assert.match(service, /indexed:\s*false/);
  assert.doesNotMatch(service, /content:\s*true|questionText:\s*true|reason:\s*true|originalName:\s*true|email:\s*true/);
});

test("workspace search route is read-only", async () => {
  const route = await readFile(path.join(systemRoot, "../../app/api/search/route.ts"), "utf8");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PATCH|DELETE/);
});
