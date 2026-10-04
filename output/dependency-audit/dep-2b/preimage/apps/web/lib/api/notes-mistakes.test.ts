import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveMistake,
  createMistake,
  createMistakeAttempt,
  restoreMistake,
  updateMistake,
} from "./mistakes";
import {
  archiveNote,
  createNote,
  restoreNote,
  updateNote,
} from "./notes";

test("note adapters preserve idempotency, revision commands, and encoded paths", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ note: { id: "note-1", revision: 3 } });
  };

  try {
    await createNote({
      idempotencyKey: "note-create-key",
      subjectId: "subject-1",
      title: "Derivative card",
      content: "Definition and examples",
      masteryStatus: "partial",
      nextReviewAt: null,
    });
    await updateNote("note/one", {
      expectedRevision: 2,
      title: "Derivative card updated",
      relatedSyllabusNodeIds: ["node-1"],
      resourceIds: ["resource-1"],
    });
    await archiveNote("note/one", { expectedRevision: 3 });
    await restoreNote("note/one", { expectedRevision: 4 });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/notes"],
    ["PATCH", "http://local.test/api/notes/note%2Fone"],
    ["POST", "http://local.test/api/notes/note%2Fone/archive"],
    ["POST", "http://local.test/api/notes/note%2Fone/restore"],
  ]);
  assert.equal(
    requests.every((request) => request.headers.get("Content-Type") === "application/json"),
    true,
  );
  assert.deepEqual(await Promise.all(requests.map((request) => request.json())), [
    {
      idempotencyKey: "note-create-key",
      subjectId: "subject-1",
      title: "Derivative card",
      content: "Definition and examples",
      masteryStatus: "partial",
      nextReviewAt: null,
    },
    {
      expectedRevision: 2,
      title: "Derivative card updated",
      relatedSyllabusNodeIds: ["node-1"],
      resourceIds: ["resource-1"],
    },
    { expectedRevision: 3 },
    { expectedRevision: 4 },
  ]);
});

test("mistake adapters preserve idempotency, CAS commands, and encoded paths", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ mistake: { id: "mistake-1" }, attempt: { id: "attempt-1" } });
  };

  try {
    await createMistake({
      idempotencyKey: "mistake-create-key",
      subjectId: "subject-1",
      title: "Derivative sign mistake",
      questionText: "Find the monotonic intervals",
      cause: "careless",
      correctIdea: "Build the derivative sign chart",
      simulationLossItemId: null,
    });
    await updateMistake("mistake/one", {
      expectedUpdatedAt: "2026-08-21T00:00:00.000Z",
      title: "Derivative sign mistake updated",
      causeNote: null,
    });
    await createMistakeAttempt("mistake/one", {
      idempotencyKey: "mistake-attempt-key",
      answerMode: "TEXT",
      answerText: "Use a sign chart",
      result: "PASSED",
      durationSeconds: 90,
      note: null,
    });
    await archiveMistake("mistake/one", {
      expectedUpdatedAt: "2026-08-21T01:00:00.000Z",
    });
    await restoreMistake("mistake/one", {
      expectedUpdatedAt: "2026-08-21T02:00:00.000Z",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/mistakes"],
    ["PATCH", "http://local.test/api/mistakes/mistake%2Fone"],
    ["POST", "http://local.test/api/mistakes/mistake%2Fone/attempts"],
    ["POST", "http://local.test/api/mistakes/mistake%2Fone/archive"],
    ["POST", "http://local.test/api/mistakes/mistake%2Fone/restore"],
  ]);
  assert.equal(
    requests.every((request) => request.headers.get("Content-Type") === "application/json"),
    true,
  );
  assert.deepEqual(await Promise.all(requests.map((request) => request.json())), [
    {
      idempotencyKey: "mistake-create-key",
      subjectId: "subject-1",
      title: "Derivative sign mistake",
      questionText: "Find the monotonic intervals",
      cause: "careless",
      correctIdea: "Build the derivative sign chart",
      simulationLossItemId: null,
    },
    {
      expectedUpdatedAt: "2026-08-21T00:00:00.000Z",
      title: "Derivative sign mistake updated",
      causeNote: null,
    },
    {
      idempotencyKey: "mistake-attempt-key",
      answerMode: "TEXT",
      answerText: "Use a sign chart",
      result: "PASSED",
      durationSeconds: 90,
      note: null,
    },
    { expectedUpdatedAt: "2026-08-21T01:00:00.000Z" },
    { expectedUpdatedAt: "2026-08-21T02:00:00.000Z" },
  ]);
});

test("note and mistake adapters preserve conflict metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/notes/")) {
      return Response.json({
        error: "NOTE_REVISION_CONFLICT",
        latest: { id: "note-1", revision: 4 },
        conflictFields: ["revision"],
      }, { status: 409 });
    }
    return Response.json({
      error: "MISTAKE_UPDATED_AT_CONFLICT",
      latest: { id: "mistake-1", updatedAt: "2026-08-21T03:00:00.000Z" },
      conflictFields: ["updatedAt"],
      workbench: "/knowledge/mistakes",
    }, { status: 409 });
  };

  try {
    const noteResult = await updateNote("note-1", { expectedRevision: 3, title: "Local" });
    const mistakeResult = await updateMistake("mistake-1", {
      expectedUpdatedAt: "2026-08-21T02:00:00.000Z",
      title: "Local",
    });

    assert.equal(noteResult.ok, false);
    assert.equal(noteResult.status, 409);
    assert.equal(noteResult.body?.error, "NOTE_REVISION_CONFLICT");
    assert.deepEqual(noteResult.body?.conflictFields, ["revision"]);
    assert.deepEqual(noteResult.body?.latest, { id: "note-1", revision: 4 });

    assert.equal(mistakeResult.ok, false);
    assert.equal(mistakeResult.status, 409);
    assert.equal(mistakeResult.body?.error, "MISTAKE_UPDATED_AT_CONFLICT");
    assert.deepEqual(mistakeResult.body?.conflictFields, ["updatedAt"]);
    assert.deepEqual(mistakeResult.body?.latest, {
      id: "mistake-1",
      updatedAt: "2026-08-21T03:00:00.000Z",
    });
    assert.equal(mistakeResult.body?.workbench, "/knowledge/mistakes");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
