import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmReviewEvent,
  createReviewSchedule,
  pauseReviewSchedule,
  rescheduleReview,
  resumeReviewSchedule,
} from "./review-schedule";

test("review schedule adapter owns lifecycle endpoint paths", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ schedule: { id: "schedule-1" } });
  };
  try {
    await createReviewSchedule({ targetType: "NOTE" });
    await rescheduleReview("schedule/1", { expectedRevision: 1 });
    await pauseReviewSchedule("schedule/1", { expectedRevision: 2 });
    await resumeReviewSchedule("schedule/1", { expectedRevision: 3 });
    await confirmReviewEvent("schedule/1", { expectedRevision: 4 });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/review-schedules"],
    ["PATCH", "http://local.test/api/review-schedules/schedule%2F1"],
    ["POST", "http://local.test/api/review-schedules/schedule%2F1/pause"],
    ["POST", "http://local.test/api/review-schedules/schedule%2F1/resume"],
    ["POST", "http://local.test/api/review-schedules/schedule%2F1/events"],
  ]);
});

test("review schedule adapter preserves confirmation conflicts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: "REVISION_CONFLICT",
    latest: { revision: 5 },
    conflictFields: ["revision"],
    workbench: "/knowledge/reviews",
  }, { status: 409 });
  try {
    const result = await confirmReviewEvent("schedule-1", { expectedRevision: 4 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.body?.error, "REVISION_CONFLICT");
    assert.deepEqual(result.body?.conflictFields, ["revision"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
