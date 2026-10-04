import assert from "node:assert/strict";
import test from "node:test";
import { createLocalFocusSession, type FocusOfflineCommand } from "@/lib/client/focus-offline-store";
import type { StudySessionDto } from "@/lib/contracts";
import {
  executeFocusSessionCommand,
  type FocusSessionCommandDependencies,
} from "./focus-session-command";

const localSession = createLocalFocusSession({
  userId: "user-1",
  subjectId: "subject-1",
  subjectName: "数学",
}, new Date("2026-08-23T00:00:00.000Z"), () => "session-1");
const serverSession: StudySessionDto = { ...localSession, id: "session-1" };

function createHarness(
  postResult: Awaited<ReturnType<FocusSessionCommandDependencies["post"]>>,
) {
  const removed: string[] = [];
  const saved: Array<{ state: string; session: StudySessionDto }> = [];
  const published: Array<{ state: string; session: StudySessionDto | null }> = [];
  let postCount = 0;
  const command: FocusOfflineCommand = {
    id: "command-1",
    userId: "user-1",
    localSessionId: serverSession.id,
    serverSessionId: serverSession.id,
    action: "pause",
    body: {},
    createdAt: "2026-08-23T00:00:00.000Z",
    attempts: 0,
    state: "pending",
    lastError: null,
  };
  const dependencies: FocusSessionCommandDependencies = {
    enqueue: async (input) => ({ ...command, ...input }),
    remove: async (id) => { removed.push(id); },
    project: (session) => ({ ...session, status: "paused", pausedAt: session.updatedAt }),
    save: async (_userId, session, state) => { saved.push({ state, session }); },
    publish: (_userId, state, session) => { published.push({ state, session }); },
    post: async () => { postCount += 1; return postResult; },
    headers: () => ({}),
    isOnline: () => true,
  };
  return { dependencies, removed, saved, published, postCount: () => postCount };
}

function apiResult(
  status: number,
  body: Awaited<ReturnType<FocusSessionCommandDependencies["post"]>>["body"],
) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), body };
}

test("local focus commands are projected without a network request", async () => {
  const harness = createHarness(apiResult(500, null));
  const outcome = await executeFocusSessionCommand({
    userId: "user-1",
    session: localSession,
    action: "pause",
    body: {},
  }, harness.dependencies);
  assert.equal(outcome.kind, "applied");
  assert.equal(outcome.kind === "applied" ? outcome.syncState : null, "pending");
  assert.equal(harness.postCount(), 0);
  assert.equal(harness.saved.length, 1);
  assert.equal(harness.published.length, 1);
});

test("successful server commands remove the queued command and publish current state", async () => {
  const completed = { ...serverSession, status: "paused" as const };
  const harness = createHarness(apiResult(200, { session: completed }));
  const outcome = await executeFocusSessionCommand({
    userId: "user-1",
    session: serverSession,
    action: "pause",
    body: {},
  }, harness.dependencies);
  assert.deepEqual(outcome, {
    kind: "applied",
    session: completed,
    syncState: "current",
    queuedOffline: false,
  });
  assert.deepEqual(harness.removed, ["command-1"]);
  assert.equal(harness.saved[0]?.state, "current");
  assert.equal(harness.published[0]?.state, "current");
});

test("conflicts remove only the rejected command and expose the latest baseline", async () => {
  const latest = { ...serverSession, updatedAt: "2026-08-23T00:01:00.000Z" };
  const harness = createHarness(apiResult(409, {
    latest,
    conflictFields: ["status", "updatedAt"],
  }));
  const outcome = await executeFocusSessionCommand({
    userId: "user-1",
    session: serverSession,
    action: "pause",
    body: {},
  }, harness.dependencies);
  assert.deepEqual(outcome, {
    kind: "conflict",
    latest,
    conflictFields: ["status", "updatedAt"],
  });
  assert.deepEqual(harness.removed, ["command-1"]);
  assert.equal(harness.saved.length, 0);
});

test("server failures retain the queued command and project a pending state", async () => {
  const harness = createHarness(apiResult(503, { error: "暂时不可用" }));
  const outcome = await executeFocusSessionCommand({
    userId: "user-1",
    session: serverSession,
    action: "pause",
    body: {},
  }, harness.dependencies);
  assert.equal(outcome.kind, "applied");
  assert.equal(outcome.kind === "applied" ? outcome.queuedOffline : false, true);
  assert.deepEqual(harness.removed, []);
  assert.equal(harness.saved[0]?.state, "pending");
});

test("unauthorized commands preserve the queued command for explicit retry", async () => {
  const harness = createHarness(apiResult(401, { error: "登录已过期" }));
  const outcome = await executeFocusSessionCommand({
    userId: "user-1",
    session: serverSession,
    action: "pause",
    body: {},
  }, harness.dependencies);
  assert.deepEqual(outcome, { kind: "unauthorized" });
  assert.deepEqual(harness.removed, []);
  assert.equal(harness.saved.length, 0);
});
