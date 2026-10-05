import assert from "node:assert/strict";
import test from "node:test";
import { getLatestSimulationExamScoreRate } from "./stage-service";

test("阶段建议成绩查询保留真实零分并隔离缺失/无效目标", async () => {
  for (const [exam, expected] of [
    [{ actualScore: 0, targetScore: 100 }, 0],
    [{ actualScore: 50, targetScore: 100 }, 0.5],
    [{ actualScore: null, targetScore: 100 }, null],
    [{ actualScore: 10, targetScore: 0 }, null],
    [null, null],
  ] as const) {
    const db = { simulationExam: { findFirst: async (query: unknown) => {
      assert.deepEqual((query as { where: unknown }).where, { workspaceId: "workspace", ownerUserId: "owner", actualScore: { not: null }, targetScore: { not: null }, subjectResults: { some: {} } });
      return exam;
    } } } as unknown as NonNullable<Parameters<typeof getLatestSimulationExamScoreRate>[2]>;
    assert.equal(await getLatestSimulationExamScoreRate("workspace", "owner", db), expected);
  }
});
