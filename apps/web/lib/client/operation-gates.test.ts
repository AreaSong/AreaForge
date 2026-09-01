import assert from "node:assert/strict";
import test from "node:test";
import {
  createExclusiveOperationGate,
  createLatestOperationGate,
} from "./operation-gates";

test("latest operation gate accepts only the newest generation", () => {
  const gate = createLatestOperationGate();
  const first = gate.begin();
  const second = gate.begin();

  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.finish(first), false);
  assert.equal(gate.isCurrent(second), true);
  assert.equal(gate.finish(second), true);
  assert.equal(gate.isCurrent(second), false);
});

test("latest operation gate invalidates an in-flight generation", () => {
  const gate = createLatestOperationGate();
  const request = gate.begin();
  gate.invalidate();

  assert.equal(gate.isCurrent(request), false);
  assert.equal(gate.finish(request), false);
});

test("exclusive operation gate acquires synchronously and ignores stale releases", () => {
  const gate = createExclusiveOperationGate();
  const first = gate.acquire();

  assert.ok(first);
  assert.equal(gate.isLocked(), true);
  assert.equal(gate.acquire(), null);
  assert.equal(gate.release(first), true);

  const second = gate.acquire();
  assert.ok(second);
  assert.equal(gate.release(first), false);
  assert.equal(gate.isActive(second), true);
  assert.equal(gate.release(second), true);
  assert.equal(gate.isLocked(), false);
});
