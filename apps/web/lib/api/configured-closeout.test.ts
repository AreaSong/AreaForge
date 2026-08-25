import assert from "node:assert/strict";
import test from "node:test";
import {
  loadConfiguredRetest,
  loadConfiguredSimulation,
  toConfiguredSyllabusOptions,
} from "./configured-closeout";

test("configured closeout adapters own fixed no-store query paths", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(new URL(String(input), "http://local.test"), init);
    requests.push(request);
    if (request.url.includes("knowledge-retests")) {
      return Response.json({ retest: { id: "retest-1" } });
    }
    if (request.url.endsWith("/api/subjects")) {
      return Response.json({ subjects: [{ id: "subject-1", name: "数学" }] });
    }
    if (request.url.endsWith("/api/syllabus")) {
      return Response.json({ nodes: [{ id: "node-1", subjectId: "subject-1", title: "函数" }] });
    }
    if (request.url.endsWith("/remediations")) {
      return Response.json({ remediations: [] });
    }
    return Response.json({ exam: { id: "exam-1" } });
  };

  try {
    const retest = await loadConfiguredRetest("retest/one");
    const simulation = await loadConfiguredSimulation("exam/one");
    assert.equal(retest.ok, true);
    assert.equal(simulation.exam.ok, true);
    assert.equal(simulation.subjects.ok, true);
    assert.equal(simulation.syllabus.ok, true);
    assert.equal(simulation.remediations.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url, request.cache]), [
    ["GET", "http://local.test/api/knowledge-retests/retest%2Fone", "no-store"],
    ["GET", "http://local.test/api/simulation-exams/exam%2Fone", "no-store"],
    ["GET", "http://local.test/api/subjects", "no-store"],
    ["GET", "http://local.test/api/syllabus", "no-store"],
    ["GET", "http://local.test/api/simulation-exams/exam%2Fone/remediations", "no-store"],
  ]);
});

test("configured closeout preserves status, workbench metadata, and syllabus projection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://local.test");
    if (url.pathname.endsWith("/remediations")) {
      return Response.json({ error: "SIMULATION_EXAM_NOT_FOUND", workbench: "/test/simulations" }, { status: 404 });
    }
    if (url.pathname.endsWith("/api/syllabus")) {
      return Response.json({
        nodes: [{
          id: "root",
          subjectId: "subject-1",
          title: "函数",
          children: [{ id: "child", subjectId: "subject-1", title: "导数" }],
        }],
      });
    }
    return Response.json(url.pathname.endsWith("/api/subjects")
      ? { subjects: [] }
      : { exam: { id: "exam-1" } });
  };

  try {
    const result = await loadConfiguredSimulation("exam/one");
    assert.equal(result.remediations.status, 404);
    assert.equal(result.remediations.body?.workbench, "/test/simulations");
    assert.deepEqual(toConfiguredSyllabusOptions(result.syllabus.body?.nodes ?? []), [{
      id: "root",
      subjectId: "subject-1",
      title: "函数",
      children: [{
        id: "child",
        subjectId: "subject-1",
        title: "导数",
        children: [],
      }],
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
