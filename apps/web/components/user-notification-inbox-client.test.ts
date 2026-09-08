import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const componentPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "user-notification-inbox-client.tsx");
const pagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/(app)/settings/notifications/page.tsx");

test("durable notification UI exposes filters, lifecycle recovery and accessible status", async () => {
  const [source, page] = await Promise.all([readFile(componentPath, "utf8"), readFile(pagePath, "utf8")]);
  assert.match(source, /listUserNotifications/);
  assert.match(source, /updateUserNotification/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /role="status"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /标为已读/);
  assert.match(source, /标为未读/);
  assert.match(source, /隐藏/);
  assert.match(source, /恢复/);
  assert.match(source, /min-h-11/);
  assert.doesNotMatch(source, /sourceEntityId|eventKey|\bfetch\s*\(/);
  assert.match(page, /PLATFORM_NOTIFICATIONS_ENABLED/);
  assert.match(page, /UserNotificationInboxClient/);
  assert.match(page, /跨设备同步/);
});
