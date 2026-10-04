import assert from "node:assert/strict";
import test from "node:test";
import { fromDbTaskStatus } from "./task-serializer";

test("database task statuses normalize once at the service boundary", () => {
  assert.deepEqual(
    ["TODO", "IN_PROGRESS", "DONE", "SKIPPED", "DEFERRED"].map((status) =>
      fromDbTaskStatus(status as Parameters<typeof fromDbTaskStatus>[0])),
    ["todo", "in_progress", "done", "skipped", "deferred"],
  );
  if (false) {
    // @ts-expect-error 浏览器 DTO 状态不能倒灌到数据库 serializer。
    fromDbTaskStatus("todo");
  }
});
