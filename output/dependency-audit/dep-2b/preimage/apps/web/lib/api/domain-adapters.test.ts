import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveMotivationItem,
  requestMotivationNext,
  updateMotivationItem,
} from "./motivation";
import { sendNotificationTest, updateNotificationPreferences } from "./notification";
import {
  cancelRecoveryState,
  completeRecoveryState,
  startManualRecovery,
  startRecoverySession,
} from "./recovery";

test("motivation adapters own encoded paths and JSON methods", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ item: { id: "item-1" } });
  };
  try {
    await updateMotivationItem("item/one", { expectedRevision: 2 });
    await archiveMotivationItem("item/one", { expectedRevision: 3 });
    await requestMotivationNext("manual");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["PATCH", "http://local.test/api/motivation/items/item%2Fone"],
    ["POST", "http://local.test/api/motivation/items/item%2Fone/archive"],
    ["POST", "http://local.test/api/motivation/next"],
  ]);
  assert.equal(requests.every((request) => request.headers.get("Content-Type") === "application/json"), true);
});

test("notification and recovery adapters preserve status-specific results", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ error: "REVISION_CONFLICT" }, { status: 409 });
  };
  try {
    const preference = await updateNotificationPreferences({ expectedRevision: 1 });
    const notification = await sendNotificationTest("review");
    const recovery = await cancelRecoveryState("state/1", "用户取消");
    const session = await startRecoverySession(
      { subjectId: "subject-1" },
      { "x-areaforge-device-id": "device-1" },
    );
    assert.deepEqual(
      [preference, notification, recovery, session].map((result) => [result.ok, result.status, result.body?.error]),
      Array.from({ length: 4 }, () => [false, 409, "REVISION_CONFLICT"]),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["PATCH", "http://local.test/api/notification-preferences"],
    ["POST", "http://local.test/api/notifications/test"],
    ["POST", "http://local.test/api/recovery-states/state%2F1/cancel"],
    ["POST", "http://local.test/api/study-sessions/start"],
  ]);
  assert.equal(requests[3]?.headers.get("x-areaforge-device-id"), "device-1");
});

test("recovery state adapters expose only named lifecycle commands", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ recoveryState: { id: "state-1" } });
  };
  try {
    await startManualRecovery();
    await completeRecoveryState("state/1", "完成恢复");
    await cancelRecoveryState("state/1", "取消恢复");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/recovery-states/manual"],
    ["POST", "http://local.test/api/recovery-states/state%2F1/complete"],
    ["POST", "http://local.test/api/recovery-states/state%2F1/cancel"],
  ]);
  assert.deepEqual(await Promise.all(requests.map((request) => request.json())), [
    {},
    { exitCondition: "完成恢复" },
    { exitCondition: "取消恢复" },
  ]);
});
