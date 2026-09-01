import assert from "node:assert/strict";
import test from "node:test";
import { createKeyedHydrationGate } from "./use-keyed-draft-hydration";

test("keyed hydration invalidates older identities and cancelled generations", () => {
  const gate = createKeyedHydrationGate();
  const first = gate.begin("draft-a");
  const second = gate.begin("draft-b");
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  gate.cancel(second);
  assert.equal(gate.isCurrent(second), false);
});
