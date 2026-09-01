import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptMonotonicSnapshot,
  advanceMonotonicSequence,
  createMonotonicSnapshotClock,
} from "./monotonic-snapshot";

test("snapshot acceptance requires both a newer request and nondecreasing server time", () => {
  const initial = createMonotonicSnapshotClock("2026-08-22T10:00:00.000Z");
  const accepted = acceptMonotonicSnapshot(initial, {
    requestSequence: 2,
    serverTime: "2026-08-22T10:00:01.000Z",
  });
  assert.ok(accepted);
  assert.equal(acceptMonotonicSnapshot(accepted, {
    requestSequence: 1,
    serverTime: "2026-08-22T10:00:02.000Z",
  }), null);
  assert.equal(acceptMonotonicSnapshot(accepted, {
    requestSequence: 3,
    serverTime: "2026-08-22T09:59:59.000Z",
  }), null);
});

test("local activity events invalidate older in-flight server reads", () => {
  const initial = createMonotonicSnapshotClock("2026-08-22T10:00:00.000Z");
  const advanced = advanceMonotonicSequence(initial, 3);
  assert.ok(advanced);
  assert.equal(acceptMonotonicSnapshot(advanced, {
    requestSequence: 2,
    serverTime: "2026-08-22T10:00:02.000Z",
  }), null);
});
