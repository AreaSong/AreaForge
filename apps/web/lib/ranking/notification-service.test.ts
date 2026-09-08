import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("ranking notification service gates the durable queue separately from direct notification writes", async () => {
  const source = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "notification-service.ts"), "utf8");
  assert.match(source, /PLATFORM_NOTIFICATIONS_ENABLED.*PLATFORM_NOTIFICATION_QUEUE_ENABLED/);
  assert.match(source, /enqueueDataJobInTransaction/);
  assert.match(source, /kind: "NOTIFICATION"/);
  assert.match(source, /payloadJson: payload/);
  assert.match(source, /return enqueueUserNotification/);
});
