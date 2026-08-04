import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import { getNavigationTrail, isContentDetailPath, sanitizeReturnPath, withReturnTo } from "@/lib/navigation/batch7";
import { getSourceContextLabel } from "@/lib/navigation/return-context";
import { getWorkbenchFallback } from "@/lib/navigation/workbench-context";

test("navigation trails keep reused secondary labels and object depth", () => {
  assert.deepEqual(getNavigationTrail("/roadmap/arrangements"), [
    { href: "/roadmap", label: "路线" },
    { href: "/roadmap/arrangements", label: "学习安排" },
  ]);
  assert.deepEqual(getNavigationTrail("/roadmap/stages"), [
    { href: "/roadmap", label: "路线" },
    { href: "/roadmap/stages", label: "阶段" },
  ]);
  assert.deepEqual(getNavigationTrail("/roadmap/reports/daily"), [
    { href: "/roadmap", label: "路线" },
    { href: "/roadmap/reports", label: "周期复盘" },
    { href: "/roadmap/reports/daily", label: "每日复盘" },
  ]);
  assert.deepEqual(getNavigationTrail("/roadmap/reports/history/decision-1"), [
    { href: "/roadmap", label: "路线" },
    { href: "/roadmap/reports", label: "周期复盘" },
    { href: "/roadmap/reports/history/decision-1", label: "冻结报告" },
  ]);
  assert.deepEqual(getNavigationTrail("/confirmations"), [
    { href: "/confirmations", label: "确认中心" },
  ]);
  assert.deepEqual(getNavigationTrail("/test/simulations"), [
    { href: "/test", label: "检验" },
    { href: "/test/simulations", label: "模拟考试" },
  ]);
  assert.deepEqual(getNavigationTrail("/knowledge/points/point-1"), [
    { href: "/knowledge", label: "知识" },
    { href: "/knowledge/points", label: "知识点" },
    { href: "/knowledge/points/point-1", label: "知识点详情" },
  ]);
  assert.deepEqual(getNavigationTrail("/focus"), [
    { href: "/focus", label: "开始学习" },
  ]);
  assert.deepEqual(getNavigationTrail("/knowledge/reviews/review-1"), [
    { href: "/knowledge", label: "知识" },
    { href: "/knowledge/reviews", label: "到期复习" },
    { href: "/knowledge/reviews/review-1", label: "复习排期详情" },
  ]);
  assert.deepEqual(getNavigationTrail("/confirmations/confirmation-1"), [
    { href: "/confirmations", label: "确认中心" },
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
  assert.equal(isContentDetailPath("/roadmap/arrangements/tasks/task-1"), true);
  assert.equal(isContentDetailPath("/knowledge/resources/resource-1/preview"), true);
  assert.equal(isContentDetailPath("/test/retests/new"), true);
  assert.equal(isContentDetailPath("/roadmap/reports/history/decision-1"), true);
  assert.equal(isContentDetailPath("/confirmations/confirmation-1"), true);
  assert.equal(isContentDetailPath("/confirmations/history"), false);
  assert.equal(isContentDetailPath("/roadmap/arrangements"), false);
  assert.equal(isContentDetailPath("/knowledge/points"), false);
  assert.equal(isContentDetailPath("/settings/ai"), false);
});

test("workbench errors return to the canonical owner for every primary entry", () => {
  const cases = [
    ["/focus", "/focus", "返回开始学习"],
    ["/today", "/today", "返回今日"],
    ["/roadmap/arrangements/tasks/task-1", "/roadmap/arrangements", "返回学习安排"],
    ["/knowledge/points/point-1", "/knowledge", "返回知识工作台"],
    ["/test/simulations/exam-1", "/test", "返回检验工作台"],
    ["/roadmap/stages/trend", "/roadmap/stages", "返回阶段工作台"],
    ["/roadmap/reports/history/report-1", "/roadmap/reports", "返回周期复盘"],
    ["/confirmations/history", "/confirmations", "返回确认中心"],
    ["/settings/ai", "/settings", "返回设置总览"],
    ["/knowledge/reviews/review-1", "/knowledge", "返回知识工作台"],
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
    sanitizeReturnPath("/roadmap/arrangements?date=2026-08-04&subjectId=math&status=open&q=limits&unsafe=drop"),
    "/roadmap/arrangements?date=2026-08-04&subjectId=math&status=open&q=limits",
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
