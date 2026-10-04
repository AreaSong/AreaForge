import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUserNotificationContent,
  transitionUserNotification,
  USER_NOTIFICATION_KINDS,
} from "./user-notification";

test("durable notification content is generic and routes to the controlled data center", () => {
  for (const kind of USER_NOTIFICATION_KINDS) {
    const content = buildUserNotificationContent(kind);
    assert.equal(content.route, "/settings/data");
    assert.ok(content.title.length > 0);
    assert.ok(content.body.length > 0);
    assert.doesNotMatch(`${content.title}${content.body}`, /申诉正文|挑战名称|任务标题|动机|情绪/);
  }
});

test("notification read, unread, dismiss and restore transitions are revision fenced", () => {
  const unread = { revision: 1, readAt: null, dismissedAt: null };
  const read = transitionUserNotification({ state: unread, action: "read", expectedRevision: 1, now: "2026-09-06T00:00:00Z" });
  assert.equal(read.revision, 2);
  assert.equal(read.readAt, "2026-09-06T00:00:00.000Z");
  const dismissed = transitionUserNotification({ state: read, action: "dismiss", expectedRevision: 2, now: "2026-09-06T00:01:00Z" });
  assert.equal(dismissed.dismissedAt, "2026-09-06T00:01:00.000Z");
  const restored = transitionUserNotification({ state: dismissed, action: "restore", expectedRevision: 3, now: "2026-09-06T00:02:00Z" });
  assert.equal(restored.dismissedAt, null);
  const unreadAgain = transitionUserNotification({ state: restored, action: "unread", expectedRevision: 4, now: "2026-09-06T00:03:00Z" });
  assert.equal(unreadAgain.readAt, null);
});

test("notification transitions reject stale revisions and malformed lifecycle state", () => {
  assert.throws(() => transitionUserNotification({ state: { revision: 2, readAt: null, dismissedAt: null }, action: "read", expectedRevision: 1, now: "2026-09-06T00:00:00Z" }), /REVISION_CONFLICT/);
  assert.throws(() => transitionUserNotification({ state: { revision: 1, readAt: null, dismissedAt: "2026-09-06T00:00:00Z" }, action: "restore", expectedRevision: 1, now: "2026-09-06T00:00:00Z" }), /STATE_INVALID/);
  assert.throws(() => transitionUserNotification({ state: { revision: 1, readAt: null, dismissedAt: null }, action: "unread", expectedRevision: 1, now: "2026-09-06T00:00:00Z" }), /ACTION_INVALID/);
});
