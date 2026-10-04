import assert from "node:assert/strict";
import { test } from "node:test";
import { readReportDecisionFocus, readReportHistorySnapshot } from "@/lib/study/report-history-snapshot";

test("current report snapshots retain the detailed history fields", () => {
  const snapshot = readReportHistorySnapshot({
    metrics: {
      totalMinutes: 480,
      effectiveMinutes: 360,
      taskCompletionRate: 0.75,
      reviewCompletionRate: 0.5,
      debtCount: 2,
      lowConversionCount: 1,
    },
    weakness: { title: "最大短板", detail: "图算法", reasons: ["复测未通过"] },
    strategy: { mustPressIssue: "先做专项复测" },
    nextCycleDraft: { stageAdjustment: "保持总量" },
  });

  assert.equal(snapshot.format, "current");
  assert.equal(snapshot.metrics.effectiveMinutes, 360);
  assert.equal(snapshot.metrics.taskCompletionRate, 0.75);
  assert.deepEqual(snapshot.weakness?.reasons, ["复测未通过"]);
  assert.equal(snapshot.mustPressIssue, "先做专项复测");
  assert.equal(snapshot.stageAdjustment, "保持总量");
});

test("legacy compact snapshots expose only facts that were actually stored", () => {
  const snapshot = readReportHistorySnapshot({
    totalMinutes: 486,
    effectiveMinutes: 351,
    completionRate: 0.71,
    lowConversionCount: 1,
  });

  assert.equal(snapshot.format, "legacy");
  assert.deepEqual(snapshot.metrics, {
    totalMinutes: 486,
    effectiveMinutes: 351,
    taskCompletionRate: 0.71,
    reviewCompletionRate: null,
    debtCount: null,
    lowConversionCount: 1,
  });
  assert.equal(snapshot.weakness, null);
  assert.equal(snapshot.stageAdjustment, null);
});

test("malformed history snapshots fail closed without inventing values", () => {
  const snapshot = readReportHistorySnapshot({ metrics: "invalid", weakness: { title: "缺少详情" } });
  assert.equal(snapshot.format, "legacy");
  assert.equal(snapshot.metrics.effectiveMinutes, null);
  assert.equal(snapshot.weakness, null);
});

test("history focus supports current text and legacy label arrays", () => {
  assert.equal(readReportDecisionFocus({ focus: "图算法" }), "图算法");
  assert.equal(readReportDecisionFocus({ focus: ["导数应用", "最短路径"] }), "导数应用、最短路径");
  assert.equal(readReportDecisionFocus({ focus: [] }), null);
});
