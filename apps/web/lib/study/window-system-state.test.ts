import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateVisibleWindowCount,
  deleteRegistryWindow,
  emptyWindowRegistry,
  materializeWindowInstances,
  mergeWindowRegistries,
  migrateLegacyWindowRegistry,
  minimizeForegroundWindow,
  normalizeWindowRegistry,
  updateRegistryWindowMetadata,
  upsertRegistryWindow,
  type WindowInstance,
  type WindowRegistryState,
  type WindowVersionStamp,
} from "./window-system-state";

function stamp(counter: number, actorId = "tab-a"): WindowVersionStamp {
  return { counter, actorId };
}

function registryWindow(
  key: string,
  currentStamp: WindowVersionStamp,
  title = key,
): WindowRegistryState {
  return upsertRegistryWindow(emptyWindowRegistry(), { key, kind: "test", title }, 10, currentStamp);
}

function legacyWindow(overrides: Partial<WindowInstance> = {}): WindowInstance {
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

test("registry materialization keeps foreground state local to each tab", () => {
  const one = registryWindow("one", stamp(1));
  const registry = upsertRegistryWindow(one, { key: "two", kind: "test", title: "窗口二" }, 20, stamp(2));

  const firstTab = materializeWindowInstances(registry, "one");
  const secondTab = materializeWindowInstances(registry, "two");
  assert.equal(firstTab.find((item) => item.key === "one")?.focused, true);
  assert.equal(firstTab.find((item) => item.key === "two")?.minimized, true);
  assert.equal(secondTab.find((item) => item.key === "one")?.minimized, true);
  assert.equal(secondTab.find((item) => item.key === "two")?.focused, true);
});

test("minimizing an already-background window is idempotent", () => {
  assert.equal(minimizeForegroundWindow("one", "two"), "one");
  assert.equal(minimizeForegroundWindow(null, "two"), null);
  assert.equal(minimizeForegroundWindow("two", "two"), null);
});

test("disjoint concurrent windows survive registry merge", () => {
  const left = registryWindow("local", stamp(1, "tab-a"));
  const right = registryWindow("incoming", stamp(1, "tab-b"));
  const merged = mergeWindowRegistries(left, right);

  assert.deepEqual(materializeWindowInstances(merged, null).map((item) => item.key), ["incoming", "local"]);
});

test("registry merge is commutative, associative, and idempotent", () => {
  const a = registryWindow("a", stamp(1, "a"));
  const b = registryWindow("b", stamp(1, "b"));
  const c = registryWindow("c", stamp(1, "c"));

  assert.deepEqual(mergeWindowRegistries(a, b), mergeWindowRegistries(b, a));
  assert.deepEqual(
    mergeWindowRegistries(mergeWindowRegistries(a, b), c),
    mergeWindowRegistries(a, mergeWindowRegistries(b, c)),
  );
  assert.deepEqual(mergeWindowRegistries(a, a), a);
});

test("same counter conflicts use actor id as deterministic tie-break", () => {
  const oldTitle = registryWindow("shared", stamp(4, "tab-a"), "旧标题");
  const newTitle = registryWindow("shared", stamp(4, "tab-z"), "新标题");
  const merged = mergeWindowRegistries(oldTitle, newTitle);

  assert.equal(materializeWindowInstances(merged, null)[0]?.title, "新标题");
});

test("a tombstone wins over older state and prevents resurrection", () => {
  const opened = registryWindow("shared", stamp(3, "tab-a"));
  const deleted = deleteRegistryWindow(opened, "shared", stamp(4, "tab-a"));
  const staleUpdate = updateRegistryWindowMetadata(opened, "shared", { kind: "test", title: "过期标题" }, 30, stamp(3, "tab-z"));
  const merged = mergeWindowRegistries(deleted, staleUpdate);

  assert.equal(materializeWindowInstances(merged, "shared").length, 0);
});

test("a deliberate newer open can supersede a tombstone", () => {
  const opened = registryWindow("shared", stamp(1));
  const deleted = deleteRegistryWindow(opened, "shared", stamp(2));
  const reopened = upsertRegistryWindow(deleted, { key: "shared", kind: "test", title: "重新打开" }, 40, stamp(3));

  assert.equal(materializeWindowInstances(reopened, null)[0]?.title, "重新打开");
});

test("legacy v1 persistence migrates deduplicated windows into the v2 registry", () => {
  const migrated = migrateLegacyWindowRegistry({
    revision: 7,
    windows: [
      legacyWindow({ updatedAt: 1 }),
      legacyWindow({ updatedAt: 9, title: "新窗口标题" }),
      legacyWindow({ key: "two", title: "窗口二" }),
    ],
  });
  const restored = materializeWindowInstances(migrated, null);

  assert.equal(migrated.version, 2);
  assert.equal(restored.length, 2);
  assert.equal(restored.find((item) => item.key === "one")?.title, "新窗口标题");
  assert.equal(restored.every((item) => item.minimized && !item.focused), true);
});

test("normalization rejects malformed records and keeps the deterministic winner", () => {
  const valid = registryWindow("one", stamp(2, "tab-b"));
  const stale = registryWindow("one", stamp(1, "tab-a"), "旧标题");
  const normalized = normalizeWindowRegistry({
    version: 2,
    records: [...stale.records, { invalid: true }, ...valid.records],
  });

  assert.deepEqual(normalized, valid);
});

test("Dock reserves overflow only when two or more items remain hidden", () => {
  const more = new Map([[1, 100], [2, 100], [3, 100]]);
  assert.equal(calculateVisibleWindowCount(720, [170, 170, 170, 170], more), 4);
  assert.equal(calculateVisibleWindowCount(540, [170, 170, 170, 170], more), 2);
  assert.equal(calculateVisibleWindowCount(360, [170, 170], more), 2);
  assert.equal(calculateVisibleWindowCount(270, [170, 170], new Map([[1, 90]])), 2);
  assert.equal(calculateVisibleWindowCount(150, [170], new Map([[1, 120]])), 1);
  assert.equal(calculateVisibleWindowCount(0, [170], new Map([[1, 120]])), 1);
});
