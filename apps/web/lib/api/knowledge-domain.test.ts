import assert from "node:assert/strict";
import test from "node:test";
import {
  createKnowledgePoint,
  updateKnowledgePoint,
} from "./knowledge";
import {
  confirmKnowledgeRetest,
  createKnowledgeRetest,
  startKnowledgeRetest,
  submitKnowledgeRetest,
} from "./knowledge-retest";
import { updateMistakeLinks } from "./mistakes";

test("knowledge point adapters preserve idempotency and revision commands", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ knowledgePoint: { id: "point-1", revision: 3 } });
  };

  try {
    await createKnowledgePoint({
      idempotencyKey: "knowledge-create-key",
      subjectId: "subject-1",
      title: "Quadratic extrema",
      boundary: null,
    });
    await updateKnowledgePoint("point/one", {
      expectedRevision: 2,
      title: "Quadratic extrema and bounds",
      nextRetestAt: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/knowledge-points"],
    ["PATCH", "http://local.test/api/knowledge-points/point%2Fone"],
  ]);
  assert.equal(
    requests.every((request) => request.headers.get("Content-Type") === "application/json"),
    true,
  );
  assert.deepEqual(await Promise.all(requests.map((request) => request.json())), [
    {
      idempotencyKey: "knowledge-create-key",
      subjectId: "subject-1",
      title: "Quadratic extrema",
      boundary: null,
    },
    {
      expectedRevision: 2,
      title: "Quadratic extrema and bounds",
      nextRetestAt: null,
    },
  ]);
});

test("knowledge retest adapters preserve named lifecycle endpoints and payloads", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ retest: { id: "retest-1", revision: 2 } });
  };

  try {
    await createKnowledgeRetest({
      idempotencyKey: "retest-create-key",
      title: "Targeted retest",
      method: "Recall and explain",
      knowledgePointIds: ["point-1"],
    });
    await startKnowledgeRetest("retest/one", {
      idempotencyKey: "retest-start-key",
      expectedRevision: 1,
    });
    await submitKnowledgeRetest("retest/one", {
      idempotencyKey: "retest-submit-key",
      expectedRevision: 2,
      summary: "Summary",
      reviewText: "Review",
      points: [{
        pointId: "retest-point-1",
        result: "PASSED",
        score: 90,
        understanding: null,
        note: "Explained independently",
      }],
    });
    await confirmKnowledgeRetest("retest/one", {
      idempotencyKey: "retest-confirm-key",
      expectedRevision: 3,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/knowledge-retests"],
    ["POST", "http://local.test/api/knowledge-retests/retest%2Fone/start"],
    ["POST", "http://local.test/api/knowledge-retests/retest%2Fone/submit"],
    ["POST", "http://local.test/api/knowledge-retests/retest%2Fone/confirm"],
  ]);
  assert.equal(
    requests.every((request) => request.headers.get("Content-Type") === "application/json"),
    true,
  );
  assert.deepEqual(await Promise.all(requests.map((request) => request.json())), [
    {
      idempotencyKey: "retest-create-key",
      title: "Targeted retest",
      method: "Recall and explain",
      knowledgePointIds: ["point-1"],
    },
    { idempotencyKey: "retest-start-key", expectedRevision: 1 },
    {
      idempotencyKey: "retest-submit-key",
      expectedRevision: 2,
      summary: "Summary",
      reviewText: "Review",
      points: [{
        pointId: "retest-point-1",
        result: "PASSED",
        score: 90,
        understanding: null,
        note: "Explained independently",
      }],
    },
    { idempotencyKey: "retest-confirm-key", expectedRevision: 3 },
  ]);
});

test("knowledge domain adapters preserve CAS conflict metadata", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(new URL(String(input), "http://local.test"), init);
    requests.push(request);
    if (request.url.includes("/api/knowledge-points/")) {
      return Response.json({
        error: "KNOWLEDGE_POINT_REVISION_CONFLICT",
        latest: { id: "point-1", revision: 4 },
        conflictFields: ["revision"],
      }, { status: 409 });
    }
    if (request.url.includes("/api/knowledge-retests/")) {
      return Response.json({
        error: "KNOWLEDGE_RETEST_START_REVISION_CONFLICT",
        conflictFields: ["revision"],
      }, { status: 409 });
    }
    return Response.json({
      error: "MISTAKE_UPDATED_AT_CONFLICT",
      latest: { id: "mistake-1", updatedAt: "2026-08-21T01:00:00.000Z" },
      conflictFields: ["updatedAt"],
      workbench: "/knowledge/mistakes",
    }, { status: 409 });
  };

  try {
    const knowledgePointResult = await updateKnowledgePoint("point/one", {
      expectedRevision: 3,
      title: "Latest title",
    });
    const retestResult = await startKnowledgeRetest("retest/one", {
      idempotencyKey: "retest-start-key",
      expectedRevision: 2,
    });
    const mistakeResult = await updateMistakeLinks("mistake/one", {
      expectedUpdatedAt: "2026-08-21T00:00:00.000Z",
      noteIds: ["note-1"],
      resourceIds: ["resource-1"],
    });

    assert.equal(knowledgePointResult.status, 409);
    assert.equal(knowledgePointResult.body?.error, "KNOWLEDGE_POINT_REVISION_CONFLICT");
    assert.equal(knowledgePointResult.body?.latest?.revision, 4);
    assert.deepEqual(knowledgePointResult.body?.conflictFields, ["revision"]);

    assert.equal(retestResult.status, 409);
    assert.equal(retestResult.body?.error, "KNOWLEDGE_RETEST_START_REVISION_CONFLICT");
    assert.deepEqual(retestResult.body?.conflictFields, ["revision"]);

    assert.equal(mistakeResult.ok, false);
    assert.equal(mistakeResult.status, 409);
    assert.equal(mistakeResult.body?.error, "MISTAKE_UPDATED_AT_CONFLICT");
    assert.deepEqual(mistakeResult.body?.conflictFields, ["updatedAt"]);
    assert.equal(mistakeResult.body?.latest?.updatedAt, "2026-08-21T01:00:00.000Z");
    assert.equal(mistakeResult.body?.workbench, "/knowledge/mistakes");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["PATCH", "http://local.test/api/knowledge-points/point%2Fone"],
    ["POST", "http://local.test/api/knowledge-retests/retest%2Fone/start"],
    ["PATCH", "http://local.test/api/mistakes/mistake%2Fone/links"],
  ]);
  assert.deepEqual(await Promise.all(requests.map((request) => request.json())), [
    { expectedRevision: 3, title: "Latest title" },
    { idempotencyKey: "retest-start-key", expectedRevision: 2 },
    {
      expectedUpdatedAt: "2026-08-21T00:00:00.000Z",
      noteIds: ["note-1"],
      resourceIds: ["resource-1"],
    },
  ]);
});
