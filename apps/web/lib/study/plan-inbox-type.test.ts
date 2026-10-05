import assert from "node:assert/strict";
import test from "node:test";
import { TASK_TYPES, resolveDraftTaskType } from "@areaforge/core";
import { requirePlanInboxTaskType } from "./plan-inbox-service";
import { updateTaskSchema } from "./schemas";

test("草稿转换只产生正式任务类型，历史缺省与focus收口为study", () => {
  for (const value of [...TASK_TYPES, "focus", "", null, undefined]) {
    const type = requirePlanInboxTaskType(value);
    assert.ok(TASK_TYPES.includes(type));
    assert.equal(resolveDraftTaskType(value), type);
  }
  assert.equal(requirePlanInboxTaskType("focus"), "study");
  for (const value of ["custom", "FOCUS", "unknown"]) {
    assert.equal(resolveDraftTaskType(value), null);
    assert.throws(() => requirePlanInboxTaskType(value), { message: "PLAN_INBOX_TASK_TYPE_INVALID" });
  }
  assert.equal(updateTaskSchema.safeParse({ expectedStatus: "todo", expectedUpdatedAt: "2026-10-04T00:00:00.000Z", type: "custom" }).success, false);
});
