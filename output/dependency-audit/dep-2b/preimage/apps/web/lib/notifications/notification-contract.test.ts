import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("durable notification routes derive recipients from the session and expose no source ids", async () => {
  const root = path.resolve(process.cwd(), "../..");
  const [service, listRoute, itemRoute, contract, migration] = await Promise.all([
    readFile(path.join(process.cwd(), "lib/notifications/inbox-service.ts"), "utf8"),
    readFile(path.join(process.cwd(), "app/api/notifications/route.ts"), "utf8"),
    readFile(path.join(process.cwd(), "app/api/notifications/[id]/route.ts"), "utf8"),
    readFile(path.join(process.cwd(), "lib/contracts/notification.ts"), "utf8"),
    readFile(path.join(root, "prisma/migrations/20260906150000_v19_user_notifications/migration.sql"), "utf8"),
  ]);
  assert.match(listRoute, /requireApiUser\(request\)/);
  assert.match(itemRoute, /requireApiUser\(request\)/);
  assert.match(service, /recipientUserId: actorId/);
  assert.match(service, /workspaceMembership\.findFirst/);
  assert.match(service, /user: \{ status: "ACTIVE" \}/);
  assert.match(service, /workspace: \{ status: "ACTIVE" \}/);
  assert.match(service, /recipientUserId_eventKey/);
  assert.match(service, /revision: expectedRevision/);
  assert.doesNotMatch(contract, /sourceEntityId|eventKey/);
  assert.match(migration, /UserNotification_recipientUserId_eventKey_key/);
  assert.match(migration, /ON DELETE CASCADE/);
});
