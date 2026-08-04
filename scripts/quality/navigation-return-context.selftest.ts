import assert from "node:assert/strict";
import { sanitizeReturnPath, withReturnTo } from "../../apps/web/lib/navigation/batch7";
import { getCompletionReturnLabel, getReturnContextLabel } from "../../apps/web/lib/navigation/return-context";
import { getWorkbenchFallback } from "../../apps/web/lib/navigation/workbench-context";

assert.equal(sanitizeReturnPath("https://example.com/steal"), "/focus");
assert.equal(sanitizeReturnPath("//example.com/steal"), "/focus");
assert.equal(sanitizeReturnPath("/roadmap/allocation?subjectId=math&unsafe=1"), "/roadmap/allocation?subjectId=math");
assert.equal(sanitizeReturnPath("/today/plan?subjectId=math"), "/focus");
assert.equal(
  sanitizeReturnPath("/knowledge/reviews/schedule-1?returnTo=%2Froadmap%2Fallocation%3FsubjectId%3Dmath"),
  "/knowledge/reviews/schedule-1?returnTo=%2Froadmap%2Fallocation%3FsubjectId%3Dmath",
);
assert.equal(
  sanitizeReturnPath("/knowledge/reviews/schedule-1?returnTo=%2Froadmap%2Fallocation%2Ftasks%2Ftask-1%3FreturnTo%3D%252Ftoday"),
  "/knowledge/reviews/schedule-1?returnTo=%2Froadmap%2Fallocation%2Ftasks%2Ftask-1%3FreturnTo%3D%252Ftoday",
);
assert.equal(
  withReturnTo("/roadmap/allocation?status=TODO", "/roadmap/allocation/drafts?status=CONVERTED"),
  "/roadmap/allocation?status=TODO&returnTo=%2Froadmap%2Fallocation%2Fdrafts%3Fstatus%3DCONVERTED",
);
assert.equal(withReturnTo("/roadmap/allocation/tasks/task-1", "https://example.com/steal"), "/roadmap/allocation/tasks/task-1?returnTo=%2Ffocus");
assert.equal(
  withReturnTo("/roadmap/allocation/drafts", "/roadmap/reviews?tab=current&period=week"),
  "/roadmap/allocation/drafts?returnTo=%2Froadmap%2Freviews%3Ftab%3Dcurrent%26period%3Dweek",
);
assert.equal(
  sanitizeReturnPath("/stage/overview?createMilestone=milestone-1&returnTo=%2Froadmap%2Freviews%3Ftab%3Dcurrent%26period%3Dmonth"),
  "/focus",
);
assert.equal(
  withReturnTo("/roadmap/allocation/drafts", "/test/simulations/exam-1"),
  "/roadmap/allocation/drafts?returnTo=%2Ftest%2Fsimulations%2Fexam-1",
);
assert.equal(
  withReturnTo("/roadmap/allocation/drafts", "/focus/session-1?returnTo=%2Froadmap%2Fallocation%3Fdate%3D2026-08-02"),
  "/roadmap/allocation/drafts?returnTo=%2Ffocus",
);
assert.equal(
  withReturnTo("/test/simulations/exam-1", "/roadmap/allocation/drafts/item-1?returnTo=%2Ffocus"),
  "/test/simulations/exam-1?returnTo=%2Froadmap%2Fallocation%2Fdrafts%2Fitem-1%3FreturnTo%3D%252Ffocus",
);
assert.equal(
  sanitizeReturnPath("/roadmap/allocation/drafts/item-1?returnTo=%2Froadmap%2Fallocation%2Fdrafts%3Fstatus%3DOPEN%26stableRef%3Dplan-1%25401"),
  "/roadmap/allocation/drafts/item-1?returnTo=%2Froadmap%2Fallocation%2Fdrafts%3Fstatus%3DOPEN%26stableRef%3Dplan-1%25401",
);

assert.equal(getReturnContextLabel("/roadmap/allocation?subjectId=math", "fallback"), "返回投入安排");
assert.equal(getReturnContextLabel("/roadmap/allocation/drafts?status=TODO", "fallback"), "返回收件箱");
assert.equal(getReturnContextLabel("/roadmap/allocation/tasks/task-1?returnTo=%2Ftoday", "fallback"), "返回任务详情");
assert.equal(getReturnContextLabel("/knowledge/resources/resource-1", "fallback"), "返回资料");
assert.equal(getReturnContextLabel("/roadmap/reviews/daily", "fallback"), "返回复盘");
assert.equal(getReturnContextLabel("/test/simulations/exam-1", "fallback"), "返回模拟考试");
assert.equal(getReturnContextLabel("/stage/simulation/exam-1", "fallback"), "fallback");
assert.equal(getReturnContextLabel("/unknown", "fallback"), "fallback");
assert.equal(getCompletionReturnLabel("/today"), "回到今日，查看下一行动");
assert.equal(getCompletionReturnLabel("/knowledge/reviews"), "返回复习队列");

assert.deepEqual(getWorkbenchFallback("/knowledge/resources/resource-1"), { href: "/knowledge", label: "返回知识工作台" });
assert.deepEqual(getWorkbenchFallback("/roadmap/reviews"), { href: "/roadmap/reviews", label: "返回周期复盘" });
assert.deepEqual(getWorkbenchFallback("/test/simulations/exam-1"), { href: "/test/retests", label: "返回检验工作台" });
assert.deepEqual(getWorkbenchFallback("/settings/ai"), { href: "/settings/exams", label: "返回设置" });
assert.deepEqual(getWorkbenchFallback("/roadmap/allocation?status=TODO"), { href: "/roadmap/allocation", label: "返回投入安排" });
assert.deepEqual(getWorkbenchFallback("/roadmap/allocation/drafts/item-1"), { href: "/roadmap/allocation/drafts", label: "返回收件箱" });
assert.deepEqual(getWorkbenchFallback("/today/plan?status=TODO"), { href: "/focus", label: "返回开始学习" });
assert.deepEqual(getWorkbenchFallback("/stage/simulation/exam-1"), { href: "/focus", label: "返回开始学习" });
assert.deepEqual(getWorkbenchFallback("/focus/session-1"), { href: "/focus", label: "返回开始学习" });

console.log("navigation return context selftest passed");
