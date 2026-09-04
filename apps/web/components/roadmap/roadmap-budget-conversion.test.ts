import assert from "node:assert/strict";
import test from "node:test";
import type { WeeklyBudgetDto } from "@/lib/contracts";
import { computeWeeklyBudgetConversionRows } from "./roadmap-budget-conversion";

function budget(subjects: WeeklyBudgetDto["subjects"]): WeeklyBudgetDto {
  return {
    workspaceId: "workspace-1",
    weekStart: "2026-08-31",
    weekEnd: "2026-09-06",
    configuredSubjectCount: subjects.filter((subject) => subject.targetMinutes !== null).length,
    totalTargetMinutes: subjects.reduce((sum, subject) => sum + (subject.targetMinutes ?? 0), 0),
    totalActualMinutes: subjects.reduce((sum, subject) => sum + subject.actualMinutes, 0),
    totalEffectiveMinutes: subjects.reduce((sum, subject) => sum + subject.effectiveMinutes, 0),
    subjects,
  };
}

test("weekly budget conversion never invents a rate without actual study", () => {
  const [row] = computeWeeklyBudgetConversionRows(budget([{
    subjectId: "subject-1",
    subjectName: "自定义科目",
    subjectColor: "#22c55e",
    targetMinutes: 300,
    actualMinutes: 0,
    effectiveMinutes: 0,
    revision: 1,
  }]));
  assert.equal(row?.conversionRate, null);
  assert.equal(row?.status, "no_data");
  assert.equal(row?.statusLabel, "暂无样本");
});

test("weekly budget conversion distinguishes missing budget, lag, low conversion, and high efficiency", () => {
  const rows = computeWeeklyBudgetConversionRows(budget([
    { subjectId: "missing", subjectName: "未预算", subjectColor: "#fff", targetMinutes: null, actualMinutes: 60, effectiveMinutes: 50, revision: 0 },
    { subjectId: "lag", subjectName: "落后", subjectColor: "#fff", targetMinutes: 600, actualMinutes: 120, effectiveMinutes: 100, revision: 1 },
    { subjectId: "low", subjectName: "低转化", subjectColor: "#fff", targetMinutes: 300, actualMinutes: 180, effectiveMinutes: 90, revision: 1 },
    { subjectId: "high", subjectName: "高效", subjectColor: "#fff", targetMinutes: 300, actualMinutes: 240, effectiveMinutes: 220, revision: 1 },
  ]));
  assert.deepEqual(rows.map((row) => [row.subjectId, row.status, row.statusLabel]), [
    ["missing", "normal", "未设置预算"],
    ["lag", "lag", "需补投入"],
    ["low", "low_conversion", "转化偏低"],
    ["high", "high", "高效转化"],
  ]);
});
