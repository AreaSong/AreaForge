import assert from "node:assert/strict";
import test from "node:test";
import {
  closeOrMinimizeWindow,
  focusWindow,
  mergeExternalWindows,
  mergeRestoredWindows,
  nextForegroundKey,
  normalizePersistedWindows,
  minimizeWindow,
  upsertWindow,
  visibleWindowCount,
  type WindowInstance,
} from "./window-system-state";

function windowFixture(overrides: Partial<WindowInstance> = {}): WindowInstance {
  return {
    key: "one",
    kind: "test",
    title: "窗口一",
    minimized: false,
    focused: true,
    closePolicy: "free",
    workState: "clean",
    openedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("upsertWindow keeps one instance and focuses the requested window", () => {
  const current = [windowFixture(), windowFixture({ key: "two", title: "窗口二", focused: false, minimized: true })];
  const next = upsertWindow(current, { key: "two", kind: "test", title: "窗口二" }, 10);
  assert.equal(next.length, 2);
  assert.equal(next.find((item) => item.key === "two")?.focused, true);
  assert.equal(next.find((item) => item.key === "two")?.minimized, false);
});

test("minimizeOnly never removes an unfinished window", () => {
  const current = [windowFixture({ key: "closeout", closePolicy: "minimizeOnly", workState: "dirty" })];
  const next = closeOrMinimizeWindow(current, "closeout");
  assert.equal(next.length, 1);
  assert.equal(next[0]?.minimized, true);
});

test("focus and close select the most recently active non-minimized window", () => {
  const current = [
    windowFixture({ updatedAt: 1 }),
    windowFixture({ key: "two", title: "窗口二", focused: false, updatedAt: 20 }),
  ];
  const focused = focusWindow(current, "two", 30);
  assert.equal(nextForegroundKey(focused, "two"), "one");
  const minimized = minimizeWindow(focused, "two");
  assert.equal(nextForegroundKey(minimized, "two"), "one");
});

test("persisted windows are deduplicated and reopened minimized", () => {
  const value = [
    windowFixture({ updatedAt: 1 }),
    windowFixture({ updatedAt: 9, title: "新窗口标题" }),
    windowFixture({ key: "two", minimized: false, focused: true }),
  ];
  const normalized = normalizePersistedWindows(value);
  assert.equal(normalized.length, 2);
  assert.equal(normalized.find((item) => item.key === "one")?.title, "新窗口标题");
  assert.equal(normalized.every((item) => item.minimized && !item.focused), true);
});

test("external registry updates do not steal the local foreground window", () => {
  const current = [windowFixture(), windowFixture({ key: "two", title: "窗口二", minimized: true, focused: false })];
  const incoming = [windowFixture({ updatedAt: 20 }), windowFixture({ key: "two", title: "窗口二", updatedAt: 20 })];
  const merged = mergeExternalWindows(current, incoming, "one");
  assert.equal(merged.foregroundKey, "one");
  assert.equal(merged.windows.find((item) => item.key === "one")?.minimized, false);
  assert.equal(merged.windows.find((item) => item.key === "two")?.minimized, true);
});

test("restoring persistence keeps a window opened during hydration", () => {
  const opened = windowFixture({ key: "session-closeout", openedAt: 20, updatedAt: 20 });
  const persisted = windowFixture({ key: "confirmation-center", openedAt: 10, updatedAt: 10, minimized: true, focused: false });
  const restored = mergeRestoredWindows([opened], [persisted]);

  assert.deepEqual(restored.map((window) => window.key), ["confirmation-center", "session-closeout"]);
  assert.equal(restored.find((window) => window.key === "session-closeout")?.focused, true);
  assert.equal(restored.find((window) => window.key === "session-closeout")?.minimized, false);
});

test("visible window count uses the full dock width", () => {
  assert.equal(visibleWindowCount(720), 4);
  assert.equal(visibleWindowCount(540), 3);
  assert.equal(visibleWindowCount(360), 2);
  assert.equal(visibleWindowCount(200), 1);
});
