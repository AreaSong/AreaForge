import assert from "node:assert/strict";
import test from "node:test";
import { reduceEntityOperations, type EntityOperationState } from "./use-entity-operation-map";

test("entity operations isolate ids and ignore stale completions", () => {
  let state: ReadonlyMap<string, EntityOperationState> = new Map();
  state = reduceEntityOperations(state, { type: "begin", id: "note-a", generation: 1 });
  state = reduceEntityOperations(state, { type: "begin", id: "note-b", generation: 2 });
  state = reduceEntityOperations(state, { type: "begin", id: "note-a", generation: 3 });
  state = reduceEntityOperations(state, { type: "succeed", id: "note-a", generation: 1 });

  assert.deepEqual(state.get("note-a"), { generation: 3, pending: true, error: null });
  assert.deepEqual(state.get("note-b"), { generation: 2, pending: true, error: null });

  state = reduceEntityOperations(state, { type: "fail", id: "note-b", generation: 2, error: "上传失败" });
  assert.deepEqual(state.get("note-b"), { generation: 2, pending: false, error: "上传失败" });
  state = reduceEntityOperations(state, { type: "succeed", id: "note-a", generation: 3 });
  assert.equal(state.has("note-a"), false);
});
