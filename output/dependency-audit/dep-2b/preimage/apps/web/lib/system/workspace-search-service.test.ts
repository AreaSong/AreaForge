import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const systemRoot = path.dirname(fileURLToPath(import.meta.url));

test("workspace search authenticates and filters before returning private labels", async () => {
  const [service, route, scope, source] = await Promise.all([
    readFile(path.join(systemRoot, "workspace-search-service.ts"), "utf8"),
    readFile(path.join(systemRoot, "../../app/api/search/route.ts"), "utf8"),
    readFile(path.join(systemRoot, "../../../../packages/db/src/workspace-search-scope.ts"), "utf8"),
    readFile(path.join(systemRoot, "../../../../packages/db/src/workspace-search-source.ts"), "utf8"),
  ]);
  assert.match(route, /requireApiUser/);
  assert.match(route, /searchWorkspace\(actor\.id/);
  assert.match(service, /captureSearchScope/);
  assert.match(service, /queryWorkspaceSearch/);
  assert.match(service, /Serializable/);
  assert.match(scope, /workspaceGrantAllowsActor/);
  assert.match(source, /resourceOwnerUserId.*ownerUserId/);
  assert.match(source, /ownerFilter/);
  assert.doesNotMatch(service + scope + source, /content:\s*true|questionText:\s*true|reason:\s*true|originalName:\s*true|email:\s*true/);
});

test("workspace search route is read-only", async () => {
  const route = await readFile(path.join(systemRoot, "../../app/api/search/route.ts"), "utf8");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PATCH|DELETE/);
});
