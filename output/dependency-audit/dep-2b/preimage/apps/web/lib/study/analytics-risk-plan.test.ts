import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalyticsRiskPlanDraft } from "./analytics-risk-plan";

test("analytics risk plan keeps a traceable source snapshot without creating a task", () => {
  const draft = buildAnalyticsRiskPlanDraft({
    range: { start: "2026-08-27T16:00:00.000Z", end: "2026-09-03T16:00:00.000Z", days: 7 },
  }, {
    id: "node-1",
    type: "weak_node",
    severity: "danger",
    title: "线性代数节点薄弱",
    detail: "连续两次复测未通过",
    action: "复习矩阵秩并完成一次复测",
    subjectName: "数学",
    syllabusNodeId: "node-1",
    syllabusNodeTitle: "矩阵的秩",
    dueAt: null,
  }, 7, "2026-09-03T16:00:00.000Z");

  assert.equal(draft.originType, "ANALYTICS_RISK");
  assert.match(draft.originKey, /^analytics-risk:7:weak_node:node-1:/);
  assert.equal(draft.title, "复习矩阵秩并完成一次复测");
  assert.equal(draft.priority, "CRITICAL");
  assert.equal(draft.estimatedMinutes, 30);
  assert.equal(draft.primaryNodeId, "node-1");
  assert.deepEqual(draft.relatedNodeIds, ["node-1"]);
  assert.deepEqual(draft.originSnapshot.range, {
    start: "2026-08-27T16:00:00.000Z",
    end: "2026-09-03T16:00:00.000Z",
    days: 7,
  });
});

test("analytics risk plan leaves cross-subject risks editable in the inbox", () => {
  const draft = buildAnalyticsRiskPlanDraft({
    range: { start: "2026-08-04T16:00:00.000Z", end: "2026-09-03T16:00:00.000Z", days: 30 },
  }, {
    id: "weekly-completion",
    type: "low_completion",
    severity: "warning",
    title: "执行完成率偏低",
    detail: "存在计划落差",
    action: "重新安排未来七天投入",
  }, 30, "2026-09-03T16:00:00.000Z");

  assert.equal(draft.primaryNodeId, null);
  assert.deepEqual(draft.relatedNodeIds, []);
  assert.equal(draft.estimatedMinutes, 25);
  assert.equal(draft.priority, "HIGH");
});
