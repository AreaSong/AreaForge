import assert from "node:assert/strict";
import test from "node:test";
import {
  decideConfirmation,
  decideKnowledgeRetestConfirmation,
  listConfirmationViews,
} from "./confirmation";

test("confirmation adapter owns filter queries and keeps pending/history distinct", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(new URL(String(input), "http://local.test"), init);
    requests.push(request);
    const filter = new URL(request.url).searchParams.get("filter");
    return Response.json({ items: [{ id: filter }] });
  };

  try {
    const result = await listConfirmationViews("all");
    assert.equal(result.ok, true);
    assert.deepEqual(result.pending, [{ id: "pending" }]);
    assert.deepEqual(result.history, [{ id: "history" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => request.url), [
    "http://local.test/api/confirmations?filter=pending",
    "http://local.test/api/confirmations?filter=history",
  ]);
});

test("confirmation aggregate reports the first failing status", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const filter = new URL(String(input), "http://local.test").searchParams.get("filter");
    return filter === "pending"
      ? Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
      : Response.json({ items: [] });
  };
  try {
    const result = await listConfirmationViews("history");
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("confirmation command whitelist owns fixed action paths and payloads", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({
      error: "REVISION_CONFLICT",
      conflictFields: ["revision"],
      workbench: "/confirmations",
    }, { status: 409 });
  };

  try {
    const results = await Promise.all([
      decideConfirmation({
        kind: "periodic_report",
        decision: "reject",
        reportId: "report/one",
        reportKind: "month",
        expectedRevision: 4,
        rangeStart: "2026-07-01T00:00:00.000Z",
        rangeEnd: "2026-08-01T00:00:00.000Z",
      }),
      decideConfirmation({
        kind: "stage_adjustment",
        decision: "confirm",
        draftId: "draft/one",
        expectedRevision: 5,
      }),
      decideConfirmation({
        kind: "simulation",
        decision: "confirm",
        examId: "exam/one",
        expectedRevision: 6,
        ready: true,
      }),
      decideKnowledgeRetestConfirmation("retest/one", "void", {
        idempotencyKey: "retest-void-key",
        expectedRevision: 7,
      }),
    ]);
    assert.equal(results.every((result) => result.status === 409), true);
    assert.equal(results.every((result) => result.body?.workbench === "/confirmations"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/reports/report%2Fone/reject"],
    ["POST", "http://local.test/api/stage-adjustment-drafts/draft%2Fone/confirm"],
    ["POST", "http://local.test/api/simulation-exams/exam%2Fone/confirm"],
    ["POST", "http://local.test/api/knowledge-retests/retest%2Fone/void"],
  ]);
  assert.equal(
    requests.every((request) => request.headers.get("Content-Type") === "application/json"),
    true,
  );
  assert.deepEqual(await Promise.all(requests.map((request) => request.json())), [
    {
      kind: "month",
      expectedRevision: 4,
      rangeStart: "2026-07-01T00:00:00.000Z",
      rangeEnd: "2026-08-01T00:00:00.000Z",
    },
    { expectedRevision: 5 },
    { expectedRevision: 6 },
    { idempotencyKey: "retest-void-key", expectedRevision: 7 },
  ]);
});
