import assert from "node:assert/strict";
import test from "node:test";
import {
  reduceVersionedDecisionCommand,
  type VersionedDecisionCommandState,
} from "./use-versioned-decision-command";

test("versioned decision reducer preserves the frozen command until terminal completion", () => {
  let state: VersionedDecisionCommandState<{ action: string; revision: number }> = {
    command: null,
    generation: 0,
    pending: false,
    error: null,
  };
  state = reduceVersionedDecisionCommand(state, {
    type: "begin",
    command: { action: "confirm", revision: 4 },
    generation: 1,
  });
  assert.deepEqual(state, {
    command: { action: "confirm", revision: 4 },
    generation: 1,
    pending: true,
    error: null,
  });
  state = reduceVersionedDecisionCommand(state, { type: "fail", generation: 1, error: "网络不可用" });
  assert.deepEqual(state, {
    command: { action: "confirm", revision: 4 },
    generation: 1,
    pending: false,
    error: "网络不可用",
  });
  state = reduceVersionedDecisionCommand(state, { type: "begin", command: { action: "reject", revision: 5 }, generation: 2 });
  state = reduceVersionedDecisionCommand(state, { type: "succeed", generation: 2 });
  assert.deepEqual(state, { command: null, generation: 2, pending: false, error: null });
});

test("stale terminal actions cannot clear a newer decision", () => {
  const state = reduceVersionedDecisionCommand(
    { command: { action: "confirm", revision: 8 }, generation: 2, pending: true, error: null },
    { type: "succeed", generation: 1 },
  );
  assert.deepEqual(state, { command: { action: "confirm", revision: 8 }, generation: 2, pending: true, error: null });
});
