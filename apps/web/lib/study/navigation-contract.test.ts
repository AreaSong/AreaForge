import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import { getNavigationTrail, isContentDetailPath, sanitizeReturnPath, withReturnTo } from "@/lib/navigation/batch7";
import { getSourceContextLabel } from "@/lib/navigation/return-context";
import { getWorkbenchFallback } from "@/lib/navigation/workbench-context";

test("navigation trails keep reused secondary labels and object depth", () => {
  assert.deepEqual(getNavigationTrail("/plan"), [
    { href: "/plan", label: "计划" },
    { href: "/plan", label: "长期计划" },
  ]);
  assert.deepEqual(getNavigationTrail("/plan/stages"), [
    { href: "/plan/stages", label: "阶段" },
    { href: "/plan/stages", label: "阶段总览" },
  ]);
  assert.deepEqual(getNavigationTrail("/confirmations"), [
    { href: "/confirmations", label: "确认中心" },
    { href: "/confirmations", label: "待确认" },
  ]);
  assert.deepEqual(getNavigationTrail("/test/simulations"), [
    { href: "/test", label: "检验" },
    { href: "/test/simulations", label: "模拟考试" },
  ]);
  assert.deepEqual(getNavigationTrail("/knowledge/points/point-1"), [
    { href: "/knowledge/overview", label: "知识" },
    { href: "/knowledge/points", label: "知识点" },
    { href: "/knowledge/points/point-1", label: "知识点详情" },
  ]);
  assert.deepEqual(getNavigationTrail("/focus/session-1"), [
    { href: "/focus", label: "开始学习" },
    { href: "/focus/session-1", label: "专注计时" },
  ]);
  assert.deepEqual(getNavigationTrail("/quick-review/review-1"), [
    { href: "/knowledge/overview", label: "知识" },
    { href: "/knowledge/reviews", label: "复习" },
    { href: "/quick-review/review-1", label: "快速复习" },
  ]);
  assert.deepEqual(getNavigationTrail("/confirmations/confirmation-1"), [
    { href: "/confirmations", label: "确认中心" },
    { href: "/confirmations", label: "待确认" },
    { href: "/confirmations/confirmation-1", label: "确认事项详情" },
  ]);
  assert.deepEqual(getNavigationTrail("/confirmations/history"), [
    { href: "/confirmations", label: "确认中心" },
    { href: "/confirmations/history", label: "已处理" },
  ]);
});

test("simulation workbench copy stays under the test workbench", () => {
  const pageSource = readFileSync(resolve(process.cwd(), "lib/routes/test-simulations-page.tsx"), "utf8");
  const formSource = readFileSync(resolve(process.cwd(), "components/simulation-list-client.tsx"), "utf8");
  assert.match(pageSource, /eyebrow="检验"/);
  assert.doesNotMatch(pageSource, /eyebrow="阶段"/);
  assert.match(formSource, /useState\("模拟考试"\)/);
});

test("invalid return paths fall back to the independent focus entry", () => {
  assert.equal(sanitizeReturnPath("https://outside.example/path"), "/focus");
  assert.equal(sanitizeReturnPath("/not-registered"), "/focus");
  assert.equal(sanitizeReturnPath("/knowledge/points?q=matrix"), "/knowledge/points?q=matrix");
});

test("source context labels identify the originating workbench", () => {
  assert.equal(getSourceContextLabel("/knowledge/points"), "知识点");
  assert.equal(getSourceContextLabel("/test/simulations"), "模拟考试");
  assert.equal(getSourceContextLabel("/today"), "今日行动");
  assert.equal(getSourceContextLabel(undefined), "来源页面");
});

test("content detail routes remain third-level object paths", () => {
  assert.equal(isContentDetailPath("/plan/tasks/task-1"), true);
  assert.equal(isContentDetailPath("/knowledge/resources/resource-1/preview"), true);
  assert.equal(isContentDetailPath("/test/retests/new"), true);
  assert.equal(isContentDetailPath("/review/reports/history/decision-1"), true);
  assert.equal(isContentDetailPath("/confirmations/confirmation-1"), true);
  assert.equal(isContentDetailPath("/confirmations/history"), false);
  assert.equal(isContentDetailPath("/plan"), false);
  assert.equal(isContentDetailPath("/knowledge/points"), false);
  assert.equal(isContentDetailPath("/settings/ai"), false);
});

test("workbench errors return to the canonical owner for every primary entry", () => {
  const cases = [
    ["/focus/session-1", "/focus", "返回开始学习"],
    ["/today", "/today", "返回今日"],
    ["/plan/tasks/task-1", "/plan", "返回计划"],
    ["/knowledge/points/point-1", "/knowledge/overview", "返回知识工作台"],
    ["/test/simulations/exam-1", "/test", "返回检验工作台"],
    ["/plan/stages/analytics", "/plan/stages", "返回阶段工作台"],
    ["/review/reports/history/report-1", "/review/daily", "返回复盘工作台"],
    ["/confirmations/history", "/confirmations", "返回确认中心"],
    ["/settings/ai", "/settings", "返回设置总览"],
    ["/quick-review/review-1", "/knowledge/overview", "返回知识工作台"],
  ] as const;

  for (const [pathname, href, label] of cases) {
    assert.deepEqual(getWorkbenchFallback(pathname), { href, label });
  }
});

test("registered list routes preserve only their safe filter query", () => {
  assert.equal(
    sanitizeReturnPath("/knowledge/points?subjectId=math&q=matrix&masteryStatus=weak&unsafe=drop"),
    "/knowledge/points?subjectId=math&q=matrix&masteryStatus=weak",
  );
  assert.equal(
    sanitizeReturnPath("/plan?date=2026-08-04&subjectId=math&status=open&q=limits&unsafe=drop"),
    "/plan?date=2026-08-04&subjectId=math&status=open&q=limits",
  );
  assert.equal(sanitizeReturnPath("/today?date=2026-08-04&unsafe=drop"), "/today?date=2026-08-04");
});

test("confirmation detail preserves a safe list return context", () => {
  assert.equal(
    withReturnTo("/confirmations/confirmation-1", "/confirmations"),
    "/confirmations/confirmation-1?returnTo=%2Fconfirmations",
  );
  assert.equal(
    sanitizeReturnPath("/confirmations/confirmation-1?returnTo=%2Fconfirmations"),
    "/confirmations/confirmation-1?returnTo=%2Fconfirmations",
  );
  assert.equal(
    sanitizeReturnPath("/confirmations/confirmation-1?returnTo=https%3A%2F%2Fevil.example"),
    "/confirmations/confirmation-1?returnTo=%2Ffocus",
  );
});

test("simulation detail falls back to its list instead of itself", () => {
  const source = readFileSync(resolve(process.cwd(), "lib/routes/test-simulation-detail-page.tsx"), "utf8");
  assert.match(source, /query\.returnTo \? sanitizeReturnPath\(query\.returnTo\) : "\/test\/simulations"/);
  assert.doesNotMatch(source, /: `\/test\/simulations\/\$\{encodeURIComponent\(examId\)\}`/);
});
