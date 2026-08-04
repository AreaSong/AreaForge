import assert from "node:assert/strict";
import { sanitizeReturnPath, withReturnTo } from "../../apps/web/lib/navigation/batch7";
import { getCompletionReturnLabel, getReturnContextLabel } from "../../apps/web/lib/navigation/return-context";
import { getWorkbenchFallback } from "../../apps/web/lib/navigation/workbench-context";

assert.equal(sanitizeReturnPath("https://example.com/steal"), "/focus");
assert.equal(sanitizeReturnPath("//example.com/steal"), "/focus");
assert.equal(sanitizeReturnPath("/roadmap/arrangements?subjectId=math&unsafe=1"), "/roadmap/arrangements?subjectId=math");
assert.equal(sanitizeReturnPath("/today/plan?subjectId=math"), "/focus");
assert.equal(
  sanitizeReturnPath("/knowledge/reviews/schedule-1?returnTo=%2Froadmap%2Farrangements%3FsubjectId%3Dmath"),
  "/knowledge/reviews/schedule-1?returnTo=%2Froadmap%2Farrangements%3FsubjectId%3Dmath",
);
assert.equal(
  sanitizeReturnPath("/knowledge/reviews/schedule-1?returnTo=%2Froadmap%2Farrangements%2Ftasks%2Ftask-1%3FreturnTo%3D%252Ftoday"),
  "/knowledge/reviews/schedule-1?returnTo=%2Froadmap%2Farrangements%2Ftasks%2Ftask-1%3FreturnTo%3D%252Ftoday",
);
assert.equal(
  withReturnTo("/roadmap/arrangements?status=TODO", "/roadmap/arrangements/drafts?status=CONVERTED"),
  "/roadmap/arrangements?status=TODO&returnTo=%2Froadmap%2Farrangements%2Fdrafts%3Fstatus%3DCONVERTED",
);
assert.equal(withReturnTo("/roadmap/arrangements/tasks/task-1", "https://example.com/steal"), "/roadmap/arrangements/tasks/task-1?returnTo=%2Ffocus");
assert.equal(
  withReturnTo("/roadmap/arrangements/drafts", "/roadmap/reports?tab=current&period=week"),
  "/roadmap/arrangements/drafts?returnTo=%2Froadmap%2Freports%3Ftab%3Dcurrent%26period%3Dweek",
);
assert.equal(
  sanitizeReturnPath("/stage/overview?createMilestone=milestone-1&returnTo=%2Froadmap%2Freports%3Ftab%3Dcurrent%26period%3Dmonth"),
  "/focus",
);
assert.equal(
  withReturnTo("/roadmap/arrangements/drafts", "/test/simulations/exam-1"),
  "/roadmap/arrangements/drafts?returnTo=%2Ftest%2Fsimulations%2Fexam-1",
);
assert.equal(
  withReturnTo("/roadmap/arrangements/drafts", "/focus/session-1?returnTo=%2Froadmap%2Farrangements%3Fdate%3D2026-08-02"),
  "/roadmap/arrangements/drafts?returnTo=%2Ffocus",
);
assert.equal(
  withReturnTo("/test/simulations/exam-1", "/roadmap/arrangements/drafts/item-1?returnTo=%2Ffocus"),
  "/test/simulations/exam-1?returnTo=%2Froadmap%2Farrangements%2Fdrafts%2Fitem-1%3FreturnTo%3D%252Ffocus",
);
assert.equal(
  sanitizeReturnPath("/roadmap/arrangements/drafts/item-1?returnTo=%2Froadmap%2Farrangements%2Fdrafts%3Fstatus%3DOPEN%26stableRef%3Dplan-1%25401"),
  "/roadmap/arrangements/drafts/item-1?returnTo=%2Froadmap%2Farrangements%2Fdrafts%3Fstatus%3DOPEN%26stableRef%3Dplan-1%25401",
);

assert.equal(getReturnContextLabel("/roadmap/arrangements?subjectId=math", "fallback"), "返回学习安排");
assert.equal(getReturnContextLabel("/roadmap/arrangements/drafts?status=TODO", "fallback"), "返回收件箱");
assert.equal(getReturnContextLabel("/roadmap/arrangements/tasks/task-1?returnTo=%2Ftoday", "fallback"), "返回任务详情");
assert.equal(getReturnContextLabel("/knowledge/resources/resource-1", "fallback"), "返回资料");
assert.equal(getReturnContextLabel("/roadmap/reports/daily", "fallback"), "返回复盘");
assert.equal(getReturnContextLabel("/test/simulations/exam-1", "fallback"), "返回模拟考试");
assert.equal(getReturnContextLabel("/stage/simulation/exam-1", "fallback"), "fallback");
assert.equal(getReturnContextLabel("/unknown", "fallback"), "fallback");
assert.equal(getCompletionReturnLabel("/today"), "回到今日，查看下一行动");
assert.equal(getCompletionReturnLabel("/knowledge/reviews"), "返回复习队列");

assert.deepEqual(getWorkbenchFallback("/knowledge/resources/resource-1"), { href: "/knowledge", label: "返回知识工作台" });
assert.deepEqual(getWorkbenchFallback("/roadmap/reports"), { href: "/roadmap/reports", label: "返回周期复盘" });
assert.deepEqual(getWorkbenchFallback("/test/simulations/exam-1"), { href: "/test", label: "返回检验工作台" });
assert.deepEqual(getWorkbenchFallback("/settings/ai"), { href: "/settings", label: "返回设置总览" });
assert.deepEqual(getWorkbenchFallback("/roadmap/arrangements?status=TODO"), { href: "/roadmap/arrangements", label: "返回学习安排" });
assert.deepEqual(getWorkbenchFallback("/roadmap/arrangements/drafts/item-1"), { href: "/roadmap/arrangements/drafts", label: "返回收件箱" });
assert.deepEqual(getWorkbenchFallback("/today/plan?status=TODO"), { href: "/focus", label: "返回开始学习" });
assert.deepEqual(getWorkbenchFallback("/stage/simulation/exam-1"), { href: "/focus", label: "返回开始学习" });
assert.deepEqual(getWorkbenchFallback("/focus/session-1"), { href: "/focus", label: "返回开始学习" });

console.log("navigation return context selftest passed");
