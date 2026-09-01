import assert from "node:assert/strict";
import test from "node:test";
import {
  flattenShortcutNodes,
  hasRemainingAction,
  isSameActionTarget,
  withTodayReturnTo,
} from "./action-center-today-support";

test("action-center-today-support: withTodayReturnTo decorates target routes with safe returnTo parameter", () => {
  // 1. Target routes that require returnTo
  assert.equal(
    withTodayReturnTo("/focus"),
    "/focus?returnTo=%2Ftoday",
  );
  assert.equal(
    withTodayReturnTo("/focus?mode=pomodoro"),
    "/focus?mode=pomodoro&returnTo=%2Ftoday",
  );
  assert.equal(
    withTodayReturnTo("/knowledge/reviews/card-123"),
    "/knowledge/reviews/card-123?returnTo=%2Ftoday",
  );
  assert.equal(
    withTodayReturnTo("/roadmap/allocation/tasks/task-456"),
    "/roadmap/allocation/tasks/task-456?returnTo=%2Ftoday",
  );

  // 2. Unrelated routes are not decorated
  assert.equal(
    withTodayReturnTo("/roadmap/allocation"),
    "/roadmap/allocation",
  );
  assert.equal(
    withTodayReturnTo("/settings/exams"),
    "/settings/exams",
  );
  assert.equal(
    withTodayReturnTo("/test/retests"),
    "/test/retests",
  );
});

test("action-center-today-support: isSameActionTarget compares base routes ignoring query string", () => {
  assert.equal(isSameActionTarget("/focus", "/focus?returnTo=%2Ftoday"), true);
  assert.equal(isSameActionTarget("/knowledge/reviews/1?date=2026-08-26", "/knowledge/reviews/1"), true);
  assert.equal(isSameActionTarget("/roadmap/allocation/tasks/1", "/roadmap/allocation/tasks/2"), false);
});

test("action-center-today-support: hasRemainingAction detects remaining queue items not matching primary href", () => {
  const primaryHref = "/focus?taskId=task-1";
  
  // All items match primary action target
  assert.equal(
    hasRemainingAction([{ href: "/focus?taskId=task-1" }], primaryHref),
    false,
  );

  // At least one item points to another action
  assert.equal(
    hasRemainingAction(
      [{ href: "/focus?taskId=task-1" }, { href: "/knowledge/reviews/rev-2" }],
      primaryHref,
    ),
    true,
  );

  // Empty queue
  assert.equal(hasRemainingAction([], primaryHref), false);
});

test("action-center-today-support: flattenShortcutNodes recursively flattens syllabus hierarchy with depth", () => {
  const nodes = [
    {
      id: "node-1",
      title: "高等数学",
      subjectId: "sub-math",
      children: [
        {
          id: "node-1-1",
          title: "极限与连续",
          subjectId: "sub-math",
          children: [
            {
              id: "node-1-1-1",
              title: "求极限的常用方法",
              subjectId: "sub-math",
              children: [],
            },
          ],
        },
      ],
    },
    {
      id: "node-2",
      title: "线性代数",
      subjectId: "sub-math",
      children: [],
    },
  ];

  const flattened = flattenShortcutNodes(nodes);
  assert.equal(flattened.length, 4);
  assert.equal(flattened[0].id, "node-1");
  assert.equal(flattened[0].depth, 0);
  assert.equal(flattened[1].id, "node-1-1");
  assert.equal(flattened[1].depth, 1);
  assert.equal(flattened[2].id, "node-1-1-1");
  assert.equal(flattened[2].depth, 2);
  assert.equal(flattened[3].id, "node-2");
  assert.equal(flattened[3].depth, 0);
});
