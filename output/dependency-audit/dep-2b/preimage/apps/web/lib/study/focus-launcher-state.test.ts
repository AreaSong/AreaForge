import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldUseOfflineFocusSnapshot } from "@/lib/client/focus-launcher-state";

const base = {
  snapshotSessionId: "session-1",
  snapshotStatus: "running" as const,
};

test("active server session wins over an online snapshot", () => {
  assert.equal(shouldUseOfflineFocusSnapshot({ ...base, online: true, activeSessionId: "session-2" }), "redirect-active");
});

test("online idle state clears a stale server snapshot", () => {
  assert.equal(shouldUseOfflineFocusSnapshot({ ...base, online: true, activeSessionId: null }), "clear-stale");
});

test("offline active state remains recoverable", () => {
  assert.equal(shouldUseOfflineFocusSnapshot({ ...base, online: false, activeSessionId: null }), "keep-offline");
});

test("local unsynced state remains recoverable regardless of connectivity", () => {
  assert.equal(shouldUseOfflineFocusSnapshot({ ...base, snapshotSessionId: "local-focus-1", online: true, activeSessionId: null }), "keep-local");
});

test("completed snapshots are cleared when offline", () => {
  assert.equal(shouldUseOfflineFocusSnapshot({ ...base, snapshotStatus: "completed", online: false, activeSessionId: null }), "clear-stale");
});
