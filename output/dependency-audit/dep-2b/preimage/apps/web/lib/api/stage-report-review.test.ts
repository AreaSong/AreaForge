import assert from "node:assert/strict";
import test from "node:test";
import { createDailyReview, updateDailyReview } from "./daily-review";
import { decidePeriodicReport } from "./reports";
import {
  abandonReviewBridgeTask,
  completeReviewBridgeTask,
  correctReviewEvent,
  deferReviewBridgeTask,
} from "./review-actions";
import {
  createStageAdjustmentDraft,
  createStageMilestone,
  createStagePlan,
  decideStageAdjustmentDraft,
  updateStageMilestone,
} from "./stage";

test("stage, report, and review adapters own command paths and payloads", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ error: "REVISION_CONFLICT", conflictFields: ["revision"] }, { status: 409 });
  };

  try {
    const results = await Promise.all([
      decidePeriodicReport("report/one", "confirm", {
        kind: "week",
        expectedRevision: 2,
        rangeStart: "2026-08-10T00:00:00.000Z",
        rangeEnd: "2026-08-17T00:00:00.000Z",
      }),
      createStagePlan({
        idempotencyKey: "stage-plan-key",
        baseRevision: 4,
        name: "强化阶段",
        goal: "完成核心目标",
        startDate: "2026-08-21T00:00:00.000Z",
        endDate: "2026-09-21T00:00:00.000Z",
        mode: "strengthen",
        status: "active",
      }),
      createStageAdjustmentDraft({
        idempotencyKey: "stage-draft-key",
        stagePlanId: "plan/one",
      }),
      decideStageAdjustmentDraft("draft/one", "reject", { expectedRevision: 3 }),
      createStageMilestone({
        idempotencyKey: "milestone-key",
        stagePlanId: "plan/one",
        expectedStagePlanRevision: 4,
        stableKey: "milestone-1",
        title: "完成基础复习",
        targetDate: null,
        sortOrder: 0,
      }),
      updateStageMilestone("milestone/one", { expectedRevision: 2, archive: true }),
      createDailyReview({
        idempotencyKey: "daily-review-create",
        summary: "完成复习",
        lostControl: "",
        keepAction: "继续复习",
        tomorrowMinimum: "完成 20 题",
        mood: "平静",
      }),
      updateDailyReview("review/one", {
        idempotencyKey: "daily-review-update",
        expectedRevision: 5,
        summary: "完成复习",
        keepAction: "继续复习",
        tomorrowMinimum: "完成 20 题",
      }),
      correctReviewEvent("event/one", {
        idempotencyKey: "review-correction-key",
        expectedRevision: 6,
        result: "PARTIAL",
        note: "重新核对",
      }),
      completeReviewBridgeTask("task/one", {
        idempotencyKey: "review-bridge-key",
        expectedRevision: 7,
        result: "PASSED",
        durationSeconds: 600,
        note: null,
      }),
      deferReviewBridgeTask("task/one", {
        expectedScheduleRevision: 8,
        plannedDate: "2026-08-22T00:00:00.000Z",
      }),
      abandonReviewBridgeTask("task/one"),
    ]);
    assert.equal(results.every((result) => result.status === 409), true);
    assert.equal(results.every((result) => result.body?.error === "REVISION_CONFLICT"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/reports/report%2Fone/confirm"],
    ["POST", "http://local.test/api/stage-plans"],
    ["POST", "http://local.test/api/stage-adjustment-drafts"],
    ["POST", "http://local.test/api/stage-adjustment-drafts/draft%2Fone/reject"],
    ["POST", "http://local.test/api/plan-milestones"],
    ["PATCH", "http://local.test/api/plan-milestones/milestone%2Fone"],
    ["POST", "http://local.test/api/daily-reviews"],
    ["PATCH", "http://local.test/api/daily-reviews/review%2Fone"],
    ["POST", "http://local.test/api/review-events/event%2Fone/corrections"],
    ["POST", "http://local.test/api/study-tasks/task%2Fone/bridge-complete"],
    ["POST", "http://local.test/api/study-tasks/task%2Fone/bridge-defer"],
    ["POST", "http://local.test/api/study-tasks/task%2Fone/bridge-abandon"],
  ]);
  assert.equal(
    requests.slice(0, -1).every((request) => request.headers.get("Content-Type") === "application/json"),
    true,
  );
  const payloads = await Promise.all(requests.slice(0, -1).map((request) => request.json()));
  assert.deepEqual(payloads[0], {
    kind: "week",
    expectedRevision: 2,
    rangeStart: "2026-08-10T00:00:00.000Z",
    rangeEnd: "2026-08-17T00:00:00.000Z",
  });
  assert.deepEqual(payloads[1], {
    idempotencyKey: "stage-plan-key",
    baseRevision: 4,
    name: "强化阶段",
    goal: "完成核心目标",
    startDate: "2026-08-21T00:00:00.000Z",
    endDate: "2026-09-21T00:00:00.000Z",
    mode: "strengthen",
    status: "active",
  });
  assert.deepEqual(payloads[2], {
    idempotencyKey: "stage-draft-key",
    stagePlanId: "plan/one",
  });
  assert.deepEqual(payloads[3], { expectedRevision: 3 });
  assert.deepEqual(payloads[4], {
    idempotencyKey: "milestone-key",
    stagePlanId: "plan/one",
    expectedStagePlanRevision: 4,
    stableKey: "milestone-1",
    title: "完成基础复习",
    targetDate: null,
    sortOrder: 0,
  });
  assert.deepEqual(payloads[5], { expectedRevision: 2, archive: true });
  assert.deepEqual(payloads[6], {
    idempotencyKey: "daily-review-create",
    summary: "完成复习",
    lostControl: "",
    keepAction: "继续复习",
    tomorrowMinimum: "完成 20 题",
    mood: "平静",
  });
  assert.deepEqual(payloads[7], {
    idempotencyKey: "daily-review-update",
    expectedRevision: 5,
    summary: "完成复习",
    keepAction: "继续复习",
    tomorrowMinimum: "完成 20 题",
  });
  assert.deepEqual(payloads[8], {
    idempotencyKey: "review-correction-key",
    expectedRevision: 6,
    result: "PARTIAL",
    note: "重新核对",
  });
  assert.deepEqual(payloads[9], {
    idempotencyKey: "review-bridge-key",
    expectedRevision: 7,
    result: "PASSED",
    durationSeconds: 600,
    note: null,
  });
  assert.deepEqual(payloads[10], {
    expectedScheduleRevision: 8,
    plannedDate: "2026-08-22T00:00:00.000Z",
  });
  assert.equal(requests[11]?.headers.has("Content-Type"), false);
});
