import assert from "node:assert/strict";
import { sanitizeReturnPath, withReturnTo } from "../../apps/web/lib/navigation/batch7";
import { getCompletionReturnLabel, getReturnContextLabel } from "../../apps/web/lib/navigation/return-context";
import { getWorkbenchFallback } from "../../apps/web/lib/navigation/workbench-context";

assert.equal(sanitizeReturnPath("https://example.com/steal"), "/today");
assert.equal(sanitizeReturnPath("//example.com/steal"), "/today");
assert.equal(sanitizeReturnPath("/today/plan?subjectId=math&unsafe=1"), "/today/plan?subjectId=math");
assert.equal(
  sanitizeReturnPath("/knowledge/reviews/schedule-1?returnTo=%2Ftoday%2Fplan%3FsubjectId%3Dmath"),
  "/knowledge/reviews/schedule-1?returnTo=%2Ftoday%2Fplan%3FsubjectId%3Dmath",
);
assert.equal(
  sanitizeReturnPath("/knowledge/reviews/schedule-1?returnTo=%2Ftoday%2Ftasks%2Ftask-1%3FreturnTo%3D%252Ftoday"),
  "/knowledge/reviews/schedule-1?returnTo=%2Ftoday%2Ftasks%2Ftask-1%3FreturnTo%3D%252Ftoday",
);
assert.equal(
  sanitizeReturnPath("/knowledge/resources/resource-1?returnTo=%2Fknowledge%2Freviews%2Fschedule-1%3FreturnTo%3D%252Ftoday%252Ftasks%252Ftask-1%253FreturnTo%253D%25252Ftoday%25252Fplan%25253FreturnTo%25253D%2525252Ftoday"),
  "/knowledge/resources/resource-1?returnTo=%2Fknowledge%2Freviews%2Fschedule-1%3FreturnTo%3D%252Ftoday%252Ftasks%252Ftask-1%253FreturnTo%253D%25252Ftoday%25252Fplan",
);
assert.equal(withReturnTo("/today/plan?status=TODO", "/today/inbox?status=CONVERTED"), "/today/plan?status=TODO&returnTo=%2Ftoday%2Finbox%3Fstatus%3DCONVERTED");
assert.equal(withReturnTo("/today/tasks/task-1", "https://example.com/steal"), "/today/tasks/task-1?returnTo=%2Ftoday");
assert.equal(
  withReturnTo("/today/inbox", "/review/reports?tab=current&period=week"),
  "/today/inbox?returnTo=%2Freview%2Freports%3Ftab%3Dcurrent%26period%3Dweek",
);
assert.equal(
  sanitizeReturnPath("/stage/overview?createMilestone=milestone-1&returnTo=%2Freview%2Freports%3Ftab%3Dcurrent%26period%3Dmonth"),
  "/stage/overview?createMilestone=milestone-1&returnTo=%2Freview%2Freports%3Ftab%3Dcurrent%26period%3Dmonth",
);
assert.equal(
  withReturnTo("/today/inbox", "/stage/simulation/exam-1"),
  "/today/inbox?returnTo=%2Fstage%2Fsimulation%2Fexam-1",
);
assert.equal(
  withReturnTo("/today/inbox", "/focus/session-1?returnTo=%2Ftoday%2Fplan%3Fdate%3D2026-08-02"),
  "/today/inbox?returnTo=%2Ffocus%2Fsession-1%3FreturnTo%3D%252Ftoday%252Fplan%253Fdate%253D2026-08-02",
);
assert.equal(
  withReturnTo("/stage/simulation/exam-1", "/today/inbox/item-1?returnTo=%2Ffocus%2Fsession-1"),
  "/stage/simulation/exam-1?returnTo=%2Ftoday%2Finbox%2Fitem-1%3FreturnTo%3D%252Ffocus%252Fsession-1",
);
assert.equal(
  sanitizeReturnPath("/today/inbox/item-1?returnTo=%2Ftoday%2Finbox%3Fstatus%3DOPEN%26stableRef%3Dplan-1%25401"),
  "/today/inbox/item-1?returnTo=%2Ftoday%2Finbox%3Fstatus%3DOPEN%26stableRef%3Dplan-1%25401",
);
assert.equal(
  sanitizeReturnPath("/today/inbox?stableRef=plan-1%401&returnTo=%2Ftoday%2Finbox%2Fitem-1"),
  "/today/inbox?stableRef=plan-1%401&returnTo=%2Ftoday%2Finbox%2Fitem-1",
);

assert.equal(getReturnContextLabel("/today/plan?subjectId=math", "fallback"), "返回计划");
assert.equal(getReturnContextLabel("/today/inbox?status=TODO", "fallback"), "返回收件箱");
assert.equal(getReturnContextLabel("/today/tasks/task-1?returnTo=%2Ftoday", "fallback"), "返回任务详情");
assert.equal(getReturnContextLabel("/knowledge/resources/resource-1", "fallback"), "返回资料");
assert.equal(getReturnContextLabel("/review/daily", "fallback"), "返回晚间复盘");
assert.equal(getReturnContextLabel("/stage/simulation/exam-1", "fallback"), "返回模拟考试");
assert.equal(getReturnContextLabel("/unknown", "fallback"), "fallback");
assert.equal(getCompletionReturnLabel("/today"), "回到今日，查看下一行动");
assert.equal(getCompletionReturnLabel("/knowledge/reviews"), "返回复习队列");

assert.deepEqual(getWorkbenchFallback("/knowledge/resources/resource-1"), { href: "/knowledge/overview", label: "返回知识工作台" });
assert.deepEqual(getWorkbenchFallback("/review/reports"), { href: "/review/daily", label: "返回复盘工作台" });
assert.deepEqual(getWorkbenchFallback("/stage/simulation/exam-1"), { href: "/stage/overview", label: "返回阶段工作台" });
assert.deepEqual(getWorkbenchFallback("/settings/ai"), { href: "/settings", label: "返回设置总览" });
assert.deepEqual(getWorkbenchFallback("/today/plan?status=TODO"), { href: "/today/plan", label: "返回计划" });
assert.deepEqual(getWorkbenchFallback("/today/inbox/item-1"), { href: "/today/inbox", label: "返回收件箱" });
assert.deepEqual(getWorkbenchFallback("/focus/session-1"), { href: "/today", label: "返回今日行动" });

console.log("navigation return context selftest passed");
