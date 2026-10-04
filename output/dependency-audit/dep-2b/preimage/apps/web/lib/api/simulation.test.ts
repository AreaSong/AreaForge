import assert from "node:assert/strict";
import test from "node:test";
import {
  addSimulationRemediationsToInbox,
  createAiSimulationStageAdjustmentDraft,
  createSimulationExam,
  createSimulationLossItem,
  createSimulationStageAdjustmentDraft,
  createSimulationStagePlan,
  decideSimulationStageAdjustmentDraft,
  getSimulationExam,
  saveFirstSimulationDiary,
  setSimulationLossItemArchiveState,
  startSimulationExam,
  submitSimulationExamResults,
  updateSimulationExamResults,
  updateSimulationLossItem,
} from "./simulation";

test("simulation adapters preserve command identity and revision payloads", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ error: "SIMULATION_EXAM_REVISION_CONFLICT", latest: { revision: 9 } }, { status: 409 });
  };

  const resultPayload = {
    expectedRevision: 3,
    lossReasons: [],
    mindset: "平静",
    summary: "总结",
    reviewText: "复盘",
    subjectResults: [{
      subjectId: "subject-1",
      expectedRevision: 4,
      paperFullScore: 100,
      targetScore: 80,
      actualScore: 75,
      durationMinutes: 120,
      blankQuestionCount: 1,
      lossReasons: [],
      summary: "分科总结",
    }],
  };
  const parentRevisions = {
    expectedExamRevision: 5,
    expectedSubjectResultRevision: 6,
  };

  try {
    const results = await Promise.all([
      createSimulationExam({
        idempotencyKey: "simulation-create-key",
        name: "全真模拟",
        examDate: "2026-08-21T00:00:00.000Z",
      }),
      getSimulationExam("exam/one"),
      updateSimulationExamResults("exam/one", resultPayload),
      submitSimulationExamResults("exam/one", resultPayload),
      startSimulationExam("exam/one", {
        idempotencyKey: "simulation-start-key",
        expectedRevision: 3,
      }),
      createSimulationLossItem("subject-result/one", {
        idempotencyKey: "loss-create-key",
        ...parentRevisions,
        reason: "CONCEPT_GAP",
        lostScore: 2,
        note: null,
      }),
      updateSimulationLossItem("subject-result/one", "loss/one", {
        ...parentRevisions,
        expectedRevision: 7,
        note: "修正备注",
      }),
      setSimulationLossItemArchiveState(
        "subject-result/one",
        "loss/one",
        "archive",
        { ...parentRevisions, expectedRevision: 7 },
      ),
      addSimulationRemediationsToInbox("exam/one", [{ originKey: "origin-1", originVersion: 2 }]),
      saveFirstSimulationDiary({
        idempotencyKey: "simulation-diary-key",
        firstSimulationDiary: "第一次全真模拟",
      }),
      createSimulationStagePlan({
        idempotencyKey: "simulation-stage-plan-key",
        name: "冲刺阶段",
        startDate: "2026-08-21T00:00:00.000Z",
        endDate: "2026-09-21T00:00:00.000Z",
        goal: "完成冲刺",
        mode: "sprint",
        status: "active",
      }),
      createSimulationStageAdjustmentDraft({
        idempotencyKey: "simulation-stage-draft-key",
        stagePlanId: "plan/one",
      }),
      createAiSimulationStageAdjustmentDraft({
        idempotencyKey: "simulation-ai-stage-draft-key",
        stagePlanId: "plan/one",
      }),
      decideSimulationStageAdjustmentDraft("draft/one", "confirm", 8),
    ]);
    assert.equal(results.every((result) => result.status === 409), true);
    assert.equal(results.every((result) => result.body?.error === "SIMULATION_EXAM_REVISION_CONFLICT"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/simulation/exams"],
    ["GET", "http://local.test/api/simulation-exams/exam%2Fone"],
    ["PATCH", "http://local.test/api/simulation-exams/exam%2Fone"],
    ["POST", "http://local.test/api/simulation/exams/exam%2Fone/results"],
    ["POST", "http://local.test/api/simulation-exams/exam%2Fone/start"],
    ["POST", "http://local.test/api/simulation/subject-results/subject-result%2Fone/loss-items"],
    ["PATCH", "http://local.test/api/simulation/subject-results/subject-result%2Fone/loss-items/loss%2Fone"],
    ["POST", "http://local.test/api/simulation/subject-results/subject-result%2Fone/loss-items/loss%2Fone/archive"],
    ["POST", "http://local.test/api/simulation/exams/exam%2Fone/remediations"],
    ["POST", "http://local.test/api/simulation/first-diary"],
    ["POST", "http://local.test/api/simulation/stage-plans"],
    ["POST", "http://local.test/api/simulation/stage-adjustment-drafts"],
    ["POST", "http://local.test/api/simulation/stage-adjustment-drafts/ai"],
    ["POST", "http://local.test/api/simulation/stage-adjustment-drafts/draft%2Fone/confirm"],
  ]);
  assert.equal(requests[1]?.cache, "no-store");
  assert.equal(
    requests.filter((_, index) => index !== 1)
      .every((request) => request.headers.get("Content-Type") === "application/json"),
    true,
  );
  assert.deepEqual(await requests[0]?.json(), {
    idempotencyKey: "simulation-create-key",
    name: "全真模拟",
    examDate: "2026-08-21T00:00:00.000Z",
  });
  assert.deepEqual(await requests[2]?.json(), resultPayload);
  assert.deepEqual(await requests[3]?.json(), resultPayload);
  assert.deepEqual(await requests[4]?.json(), {
    idempotencyKey: "simulation-start-key",
    expectedRevision: 3,
  });
  assert.deepEqual(await requests[5]?.json(), {
    idempotencyKey: "loss-create-key",
    ...parentRevisions,
    reason: "CONCEPT_GAP",
    lostScore: 2,
    note: null,
  });
  assert.deepEqual(await requests[6]?.json(), {
    ...parentRevisions,
    expectedRevision: 7,
    note: "修正备注",
  });
  assert.deepEqual(await requests[8]?.json(), {
    selections: [{ originKey: "origin-1", originVersion: 2 }],
  });
  assert.deepEqual(await requests[9]?.json(), {
    idempotencyKey: "simulation-diary-key",
    firstSimulationDiary: "第一次全真模拟",
  });
  assert.deepEqual(await requests[10]?.json(), {
    idempotencyKey: "simulation-stage-plan-key",
    name: "冲刺阶段",
    startDate: "2026-08-21T00:00:00.000Z",
    endDate: "2026-09-21T00:00:00.000Z",
    goal: "完成冲刺",
    mode: "sprint",
    status: "active",
  });
  assert.deepEqual(await requests[11]?.json(), {
    idempotencyKey: "simulation-stage-draft-key",
    stagePlanId: "plan/one",
  });
  assert.deepEqual(await requests[12]?.json(), {
    idempotencyKey: "simulation-ai-stage-draft-key",
    stagePlanId: "plan/one",
  });
  assert.deepEqual(await requests[13]?.json(), { expectedRevision: 8 });
});
