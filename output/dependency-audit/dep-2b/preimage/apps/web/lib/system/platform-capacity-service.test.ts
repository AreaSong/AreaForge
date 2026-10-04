import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const systemRoot = path.dirname(fileURLToPath(import.meta.url));

test("capacity snapshot stays read-only and does not invent enforcement limits", async () => {
  const [service, route] = await Promise.all([
    readFile(path.join(systemRoot, "platform-capacity-service.ts"), "utf8"),
    readFile(path.join(systemRoot, "../../app/api/system/capacity/route.ts"), "utf8"),
  ]);
  assert.match(service, /limitsConfigured:\s*false/);
  assert.match(service, /enforcementEnabled:\s*false/);
  assert.match(service, /capacityState:\s*"OBSERVED_ONLY"/);
  assert.match(service, /requireWorkspaceOwner/);
  assert.match(service, /isPlatformOperatorEmail/);
  assert.doesNotMatch(service, /evaluateWorkspaceQuota|evaluateCapacity|\.create\(|\.update|\.delete/);
  assert.match(route, /export async function GET/);
  assert.match(route, /requireApiUser/);
  assert.doesNotMatch(route, /POST|PATCH|DELETE/);
});

test("capacity snapshot exposes aggregates without private record content", async () => {
  const service = await readFile(path.join(systemRoot, "platform-capacity-service.ts"), "utf8");
  assert.match(service, /activeMemberCount/);
  assert.match(service, /activeJobCount/);
  assert.match(service, /exportJobCount24h/);
  assert.match(service, /failedJobCount24h/);
  assert.match(service, /storageBytes/);
  assert.doesNotMatch(service, /select:\s*\{[^}]*title|select:\s*\{[^}]*content|select:\s*\{[^}]*email/);
});
