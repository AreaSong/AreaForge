import assert from "node:assert/strict";
import { test } from "node:test";
import { activeTimerSessionId } from "@/lib/study/activity-session-state";
import { activityBucket } from "@/lib/study/activity-metrics";

test("only running and paused configured sessions expose a timer id", () => {
  assert.equal(activeTimerSessionId([{ id: "closing", status: "CLOSING" }]), null);
  assert.equal(activeTimerSessionId([{ id: "completed", status: "COMPLETED" }]), null);
  assert.equal(activeTimerSessionId([
    { id: "closing", status: "CLOSING" },
    { id: "paused", status: "PAUSED" },
  ]), "paused");
});

test("specialized retests are review activity, while simulations remain test activity", () => {
  assert.equal(activityBucket({ activityKind: "REVIEW", activityMode: "RETEST" }), "review");
  assert.equal(activityBucket({ activityKind: "TEST", activityMode: "SIMULATION" }), "test");
});
