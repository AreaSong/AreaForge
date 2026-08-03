import assert from "node:assert/strict";
import { sanitizeReturnPath, withReturnTo } from "../../apps/web/lib/navigation/batch7";
import { getCompletionReturnLabel, getReturnContextLabel } from "../../apps/web/lib/navigation/return-context";
import { getWorkbenchFallback } from "../../apps/web/lib/navigation/workbench-context";

assert.equal(sanitizeReturnPath("https://example.com/steal"), "/focus");
assert.equal(sanitizeReturnPath("//example.com/steal"), "/focus");
assert.equal(sanitizeReturnPath("/plan?subjectId=math&unsafe=1"), "/plan?subjectId=math");
assert.equal(sanitizeReturnPath("/today/plan?subjectId=math"), "/focus");
assert.equal(
  sanitizeReturnPath("/knowledge/reviews/schedule-1?returnTo=%2Fplan%3FsubjectId%3Dmath"),
  "/knowledge/reviews/schedule-1?returnTo=%2Fplan%3FsubjectId%3Dmath",
);
assert.equal(
  sanitizeReturnPath("/knowledge/reviews/schedule-1?returnTo=%2Fplan%2Ftasks%2Ftask-1%3FreturnTo%3D%252Ftoday"),
  "/knowledge/reviews/schedule-1?returnTo=%2Fplan%2Ftasks%2Ftask-1%3FreturnTo%3D%252Ftoday",
);
assert.equal(
  withReturnTo("/plan?status=TODO", "/plan/inbox?status=CONVERTED"),
  "/plan?status=TODO&returnTo=%2Fplan%2Finbox%3Fstatus%3DCONVERTED",
);
assert.equal(withReturnTo("/plan/tasks/task-1", "https://example.com/steal"), "/plan/tasks/task-1?returnTo=%2Ffocus");
assert.equal(
  withReturnTo("/plan/inbox", "/review/reports?tab=current&period=week"),
  "/plan/inbox?returnTo=%2Freview%2Freports%3Ftab%3Dcurrent%26period%3Dweek",
);
assert.equal(
  sanitizeReturnPath("/stage/overview?createMilestone=milestone-1&returnTo=%2Freview%2Freports%3Ftab%3Dcurrent%26period%3Dmonth"),
  "/focus",
);
assert.equal(
  withReturnTo("/plan/inbox", "/test/simulations/exam-1"),
  "/plan/inbox?returnTo=%2Ftest%2Fsimulations%2Fexam-1",
);
assert.equal(
  withReturnTo("/plan/inbox", "/focus/session-1?returnTo=%2Fplan%3Fdate%3D2026-08-02"),
  "/plan/inbox?returnTo=%2Ffocus%2Fsession-1%3FreturnTo%3D%252Fplan%253Fdate%253D2026-08-02",
);
assert.equal(
  withReturnTo("/test/simulations/exam-1", "/plan/inbox/item-1?returnTo=%2Ffocus%2Fsession-1"),
  "/test/simulations/exam-1?returnTo=%2Fplan%2Finbox%2Fitem-1%3FreturnTo%3D%252Ffocus%252Fsession-1",
);
assert.equal(
  sanitizeReturnPath("/plan/inbox/item-1?returnTo=%2Fplan%2Finbox%3Fstatus%3DOPEN%26stableRef%3Dplan-1%25401"),
  "/plan/inbox/item-1?returnTo=%2Fplan%2Finbox%3Fstatus%3DOPEN%26stableRef%3Dplan-1%25401",
);

assert.equal(getReturnContextLabel("/plan?subjectId=math", "fallback"), "返回计划");
assert.equal(getReturnContextLabel("/plan/inbox?status=TODO", "fallback"), "返回收件箱");
assert.equal(getReturnContextLabel("/plan/tasks/task-1?returnTo=%2Ftoday", "fallback"), "返回任务详情");
assert.equal(getReturnContextLabel("/knowledge/resources/resource-1", "fallback"), "返回资料");
assert.equal(getReturnContextLabel("/review/daily", "fallback"), "返回晚间复盘");
assert.equal(getReturnContextLabel("/test/simulations/exam-1", "fallback"), "返回模拟考试");
assert.equal(getReturnContextLabel("/stage/simulation/exam-1", "fallback"), "fallback");
assert.equal(getReturnContextLabel("/unknown", "fallback"), "fallback");
assert.equal(getCompletionReturnLabel("/today"), "回到今日，查看下一行动");
assert.equal(getCompletionReturnLabel("/knowledge/reviews"), "返回复习队列");

assert.deepEqual(getWorkbenchFallback("/knowledge/resources/resource-1"), { href: "/knowledge/overview", label: "返回知识工作台" });
assert.deepEqual(getWorkbenchFallback("/review/reports"), { href: "/review/daily", label: "返回复盘工作台" });
assert.deepEqual(getWorkbenchFallback("/test/simulations/exam-1"), { href: "/test", label: "返回检验工作台" });
assert.deepEqual(getWorkbenchFallback("/settings/ai"), { href: "/settings", label: "返回设置总览" });
assert.deepEqual(getWorkbenchFallback("/plan?status=TODO"), { href: "/plan", label: "返回计划" });
assert.deepEqual(getWorkbenchFallback("/plan/inbox/item-1"), { href: "/plan/inbox", label: "返回收件箱" });
assert.deepEqual(getWorkbenchFallback("/today/plan?status=TODO"), { href: "/focus", label: "返回开始学习" });
assert.deepEqual(getWorkbenchFallback("/stage/simulation/exam-1"), { href: "/focus", label: "返回开始学习" });
assert.deepEqual(getWorkbenchFallback("/focus/session-1"), { href: "/focus", label: "返回开始学习" });

console.log("navigation return context selftest passed");
