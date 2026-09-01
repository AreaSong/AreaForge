import assert from "node:assert/strict";
import test from "node:test";
import type { StudySessionDto } from "@/lib/contracts";
import {
  ensureReviewSession,
  finishReviewSession,
  resolveReviewSessionAction,
} from "@/lib/client/quick-review-activity-session";
import { createMemoryStoragePort } from "@/lib/client/storage-port";

test("quick-review session workflow preserves its request and conflict contracts", async (t) => {
  const browser = installBrowserIdentity();
  t.after(browser.restore);

  await t.test("reuses the matching running review activity", async () => {
    const session = makeSession();
    const { result, requests } = await runWithResponses([
      Response.json({ session }),
    ], () => ensureReviewSession("schedule-1", "draft-1", "subject-1"));

    assert.equal(result, true);
    assert.equal(requests.length, 1);
    assertRequest(requests[0], "GET", "/api/study-sessions/active");
    assert.equal(requests[0].cache, "no-store");
  });

  await t.test("rejects an active activity owned by another workflow", async () => {
    const session = makeSession({
      activityKind: "STUDY",
      activityMode: "FREE_STUDY",
      reviewScheduleId: null,
    });
    const { result, requests } = await runWithResponses([
      Response.json({ session }),
    ], () => ensureReviewSession("schedule-1", "draft-1", "subject-1"));

    assert.equal(result, false);
    assert.equal(requests.length, 1);
    assertRequest(requests[0], "GET", "/api/study-sessions/active");
  });

  await t.test("resumes a matching paused review with CAS and device headers", async () => {
    const paused = makeSession({ id: "session/1", status: "paused" });
    const running = makeSession({ id: "session/1", updatedAt: "2026-08-22T00:01:00.000Z" });
    const { result, requests } = await runWithResponses([
      Response.json({ session: paused }),
      Response.json({ session: running }),
    ], () => ensureReviewSession("schedule-1", "draft-1", "subject-1"));

    assert.equal(result, true);
    assert.equal(requests.length, 2);
    assertRequest(requests[1], "POST", "/api/study-sessions/session%2F1/resume");
    await assertCommandBody(requests[1], "quick-review-session/1-resume-", {
      expectedStatus: "paused",
      expectedUpdatedAt: paused.updatedAt,
    });
  });

  await t.test("starts a review session with the stable start idempotency key", async () => {
    const { result, requests } = await runWithResponses([
      Response.json({ session: null }),
      Response.json({ session: makeSession() }, { status: 201 }),
    ], () => ensureReviewSession("schedule-1", "draft-1", "subject-1"));

    assert.equal(result, true);
    assert.equal(requests.length, 2);
    assertRequest(requests[1], "POST", "/api/study-sessions/start");
    assert.deepEqual(await readRequestBody(requests[1]), {
      idempotencyKey: "quick-review-session-schedule-1-draft-1",
      subjectId: "subject-1",
      activityKind: "REVIEW",
      activityMode: "KNOWLEDGE_REVIEW",
      reviewScheduleId: "schedule-1",
      startSource: "KNOWLEDGE_REVIEW",
    });
  });

  await t.test("rereads the matching activity after a start conflict", async () => {
    const { result, requests } = await runWithResponses([
      Response.json({ session: null }),
      Response.json({ error: "ACTIVE_SESSION_EXISTS" }, { status: 409 }),
      Response.json({ session: makeSession({ status: "closing" }) }),
    ], () => ensureReviewSession("schedule-1", "draft-1", "subject-1"));

    assert.equal(result, true);
    assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
      "/api/study-sessions/active",
      "/api/study-sessions/start",
      "/api/study-sessions/active",
    ]);
  });

  await t.test("maps suspend to pause and preserves its CAS payload", async () => {
    const running = makeSession();
    const paused = makeSession({ status: "paused", updatedAt: "2026-08-22T00:02:00.000Z" });
    const { result, requests } = await runWithResponses([
      Response.json({ session: running }),
      Response.json({ session: paused }),
    ], () => resolveReviewSessionAction("schedule-1", "suspend"));

    assert.equal(result, true);
    assertRequest(requests[1], "POST", "/api/study-sessions/session-1/pause");
    await assertCommandBody(requests[1], "quick-review-session-1-pause-", {
      expectedStatus: "running",
      expectedUpdatedAt: running.updatedAt,
    });
  });

  await t.test("maps discard to cancel and preserves its CAS payload", async () => {
    const running = makeSession();
    const canceled = makeSession({ status: "canceled", updatedAt: "2026-08-22T00:03:00.000Z" });
    const { result, requests } = await runWithResponses([
      Response.json({ session: running }),
      Response.json({ session: canceled }),
    ], () => resolveReviewSessionAction("schedule-1", "discard"));

    assert.equal(result, true);
    assertRequest(requests[1], "POST", "/api/study-sessions/session-1/cancel");
    await assertCommandBody(requests[1], "quick-review-session-1-cancel-", {
      expectedStatus: "running",
      expectedUpdatedAt: running.updatedAt,
    });
  });

  await t.test("finishes through prepare and complete without changing closeout text", async () => {
    const running = makeSession();
    const closing = makeSession({ status: "closing", updatedAt: "2026-08-22T00:04:00.000Z" });
    const completed = makeSession({ status: "completed", updatedAt: "2026-08-22T00:05:00.000Z" });
    const { result, requests } = await runWithResponses([
      Response.json({ session: running }),
      Response.json({ session: closing }),
      Response.json({ session: completed }),
    ], () => finishReviewSession("schedule-1"));

    assert.equal(result, true);
    assertRequest(requests[1], "POST", "/api/study-sessions/session-1/end");
    assertRequest(requests[2], "POST", "/api/study-sessions/session-1/end");
    await assertCommandBody(requests[1], "quick-review-session-1-end-", {
      expectedStatus: "running",
      expectedUpdatedAt: running.updatedAt,
      mode: "prepare",
    });
    await assertCommandBody(requests[2], "quick-review-session-1-end-", {
      expectedStatus: "closing",
      expectedUpdatedAt: closing.updatedAt,
      mode: "complete",
      qualityScore: 3,
      isEffective: true,
      understandingLevel: "基本理解",
      minimalOutput: "快速复习计时完成，结果已记录在复习事件中。",
      nextAction: "继续按复习排期处理下一项",
      producedNote: false,
      producedMistake: false,
      completeTask: false,
      nextDisposition: "复习结果已提交",
    });
  });

  await t.test("accepts a pause conflict only after rereading paused state", async () => {
    const { result, requests } = await runWithResponses([
      Response.json({ session: makeSession() }),
      Response.json({ error: "SESSION_VERSION_CONFLICT" }, { status: 409 }),
      Response.json({ session: makeSession({ status: "paused" }) }),
    ], () => resolveReviewSessionAction("schedule-1", "suspend"));

    assert.equal(result, true);
    assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
      "/api/study-sessions/active",
      "/api/study-sessions/session-1/pause",
      "/api/study-sessions/active",
    ]);
  });

  await t.test("keeps terminal CAS conflicts unresolved when active reread is empty", async () => {
    const { result, requests } = await runWithResponses([
      Response.json({ session: makeSession() }),
      Response.json({ error: "SESSION_VERSION_CONFLICT" }, { status: 409 }),
      Response.json({ session: null }),
    ], () => resolveReviewSessionAction("schedule-1", "discard"));

    assert.equal(result, false);
    assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
      "/api/study-sessions/active",
      "/api/study-sessions/session-1/cancel",
      "/api/study-sessions/active",
    ]);
  });

  await t.test("rejects an end conflict while the reread activity is still closing", async () => {
    const closing = makeSession({ status: "closing" });
    const { result, requests } = await runWithResponses([
      Response.json({ session: closing }),
      Response.json({ error: "SESSION_VERSION_CONFLICT" }, { status: 409 }),
      Response.json({ session: closing }),
    ], () => finishReviewSession("schedule-1"));

    assert.equal(result, false);
    assert.equal(requests.length, 3);
  });
});

async function runWithResponses<T>(
  responses: Response[],
  operation: () => Promise<T>,
): Promise<{ result: T; requests: Request[] }> {
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(new URL(String(input), "http://local.test"), init);
    requests.push(request.clone());
    const response = responses.shift();
    assert.ok(response, `unexpected request: ${request.method} ${request.url}`);
    return response;
  };
  try {
    const result = await operation();
    assert.equal(responses.length, 0, "not all mocked responses were consumed");
    return { result, requests };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function assertRequest(request: Request, method: string, pathname: string): void {
  assert.equal(request.method, method);
  assert.equal(new URL(request.url).pathname, pathname);
  assert.equal(request.headers.get("x-areaforge-device-id"), "test-device-1");
  assert.equal(request.headers.get("x-areaforge-device-label"), "Test device");
  if (method === "POST") assert.equal(request.headers.get("content-type"), "application/json");
}

async function assertCommandBody(
  request: Request,
  idempotencyPrefix: string,
  expected: Record<string, unknown>,
): Promise<void> {
  const body = await readRequestBody(request);
  const { idempotencyKey, ...payload } = body;
  assert.equal(typeof idempotencyKey, "string");
  if (typeof idempotencyKey !== "string") throw new TypeError("idempotencyKey must be a string");
  assert.ok(idempotencyKey.startsWith(idempotencyPrefix));
  assert.deepEqual(payload, expected);
}

async function readRequestBody(request: Request): Promise<Record<string, unknown>> {
  return await request.json() as Record<string, unknown>;
}

function installBrowserIdentity(): { restore: () => void } {
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousWindow = globals.window;
  const localStorage = createMemoryStoragePort([
    ["areaforge.client-device-id.v1", "test-device-1"],
    ["areaforge.client-device-label.v1", "Test device"],
  ]);
  globals.window = { localStorage };
  return {
    restore() {
      if (previousWindow === undefined) delete globals.window;
      else globals.window = previousWindow;
    },
  };
}

function makeSession(overrides: Partial<StudySessionDto> = {}): StudySessionDto {
  return {
    id: "session-1",
    subjectId: "subject-1",
    subjectName: "数学",
    activityKind: "REVIEW",
    activityMode: "KNOWLEDGE_REVIEW",
    reviewScheduleId: "schedule-1",
    knowledgeRetestId: null,
    simulationExamId: null,
    taskId: null,
    taskTitle: null,
    taskStatus: null,
    syllabusNodeId: null,
    syllabusNodeTitle: null,
    knowledgePoints: [],
    status: "running",
    startedAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:30.000Z",
    pausedAt: null,
    endedAt: null,
    accumulatedPauseSeconds: 0,
    effectiveMinutes: 0,
    qualityScore: null,
    isEffective: null,
    understandingLevel: null,
    minimalOutput: null,
    nextAction: null,
    producedNote: false,
    producedMistake: false,
    isLowConversion: null,
    antiFakeReason: null,
    requiredOutput: null,
    closeoutVersion: 0,
    note: null,
    goalMinutes: null,
    startSource: "KNOWLEDGE_REVIEW",
    lowReasons: [],
    focusLevel: null,
    energyLevel: null,
    nextDisposition: null,
    clientDeviceId: null,
    clientDeviceLabel: null,
    lastHeartbeatAt: null,
    devicePresences: [],
    ...overrides,
  };
}
