import assert from "node:assert/strict";
import test from "node:test";
import { TASK_TYPES } from "@areaforge/core";
import { requireSplitTaskType } from "./task-split-type";

test("拆小沿用正式闭集，历史 focus 收口，模拟转复习，未知类型阻断", () => {
  for (const type of TASK_TYPES) {
    assert.equal(requireSplitTaskType(type), type === "simulation_exam" ? "review" : type);
  }
  assert.equal(requireSplitTaskType("focus"), "study");
  for (const type of ["custom", "FOCUS", "unknown", "", "   "]) {
    assert.throws(() => requireSplitTaskType(type), { message: "TASK_TYPE_INVALID" });
  }
});
