import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlanMilestone,
  getPlanRolling,
} from "./planning";
import {
  convertPlanInboxItem,
  transitionPlanInboxItem,
  updatePlanInboxItem,
} from "./plan-inbox";
import {
  createTask,
  executeTaskCommand,
  reorderTaskDebt,
  updateTask,
} from "./tasks";

test("task adapters own idempotent create, CAS update, and named lifecycle paths", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ task: { id: "task-1" } });
  };

  try {
    await createTask(
      {
        idempotencyKey: "task-create-key",
        subjectId: "subject-1",
        title: "Today task",
        priority: "high",
        estimatedMinutes: 25,
      },
      { headers: { "x-areaforge-device-id": "device-1" } },
    );
    await updateTask("task/one", {
      expectedStatus: "todo",
      expectedUpdatedAt: "2026-08-21T00:00:00.000Z",
      title: "Updated task",
    });
    await executeTaskCommand({
      type: "complete",
      taskId: "task/one",
      input: { reviewText: "done" },
    });
    await executeTaskCommand({
      type: "defer",
      taskId: "task/one",
      input: { reviewText: "later" },
    });
    await executeTaskCommand({
      type: "recover",
      taskId: "task/one",
      input: { reviewText: "recover" },
    });
    await executeTaskCommand({
      type: "split",
      taskId: "task/one",
      input: { title: "Small step", estimatedMinutes: 15 },
    });
    await executeTaskCommand({
      type: "convert-review",
      taskId: "task/one",
      input: { reviewText: "review" },
    });
    await executeTaskCommand({ type: "drop", taskId: "task/one" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/tasks"],
    ["PATCH", "http://local.test/api/tasks/task%2Fone"],
    ["POST", "http://local.test/api/tasks/task%2Fone/complete"],
    ["POST", "http://local.test/api/tasks/task%2Fone/defer"],
    ["POST", "http://local.test/api/tasks/task%2Fone/recover"],
    ["POST", "http://local.test/api/tasks/task%2Fone/split"],
    ["POST", "http://local.test/api/tasks/task%2Fone/convert-review"],
    ["POST", "http://local.test/api/tasks/task%2Fone/drop"],
  ]);
  assert.deepEqual(await Promise.all(requests.slice(0, 7).map((request) => request.json())), [
    {
      idempotencyKey: "task-create-key",
      subjectId: "subject-1",
      title: "Today task",
      priority: "high",
      estimatedMinutes: 25,
    },
    {
      expectedStatus: "todo",
      expectedUpdatedAt: "2026-08-21T00:00:00.000Z",
      title: "Updated task",
    },
    { reviewText: "done" },
    { reviewText: "later" },
    { reviewText: "recover" },
    { title: "Small step", estimatedMinutes: 15 },
    { reviewText: "review" },
  ]);
  assert.equal(requests[0]?.headers.get("x-areaforge-device-id"), "device-1");
  assert.equal(requests[7]?.headers.has("Content-Type"), false);
});

test("task debt reorder exposes only confirm, reject, and apply transports", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({});
  };

  try {
    await reorderTaskDebt({ type: "confirm", selectedTaskIds: ["task-1"] });
    await reorderTaskDebt({ type: "reject", selectedTaskIds: ["task-2"] });
    await reorderTaskDebt({ type: "apply", selectedTaskIds: ["task-3"] });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => request.url), [
    "http://local.test/api/tasks/debt-reorder/decisions",
    "http://local.test/api/tasks/debt-reorder/decisions",
    "http://local.test/api/tasks/debt-reorder/applications",
  ]);
  assert.deepEqual(await Promise.all(requests.map((request) => request.json())), [
    { action: "confirm", selectedTaskIds: ["task-1"] },
    { action: "reject", selectedTaskIds: ["task-2"] },
    { selectedTaskIds: ["task-3"] },
  ]);
});

test("plan inbox adapters preserve revision commands and conflict metadata", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({
      error: "PLAN_INBOX_REVISION_CONFLICT",
      latest: { id: "inbox-1", revision: 4 },
      conflictFields: ["revision"],
      workbench: "/roadmap/allocation/drafts",
    }, { status: 409 });
  };

  try {
    const updateResult = await updatePlanInboxItem("inbox/one", {
      expectedRevision: 3,
      title: "Local draft",
      predecessorTasks: [{ taskId: "task-1", dependencyType: "HARD" }],
    });
    await convertPlanInboxItem("inbox/one", {
      expectedRevision: 3,
      idempotencyKey: "plan-inbox-convert-key",
    });
    await transitionPlanInboxItem("inbox/one", "dismiss", 3);
    await transitionPlanInboxItem("inbox/one", "reopen", 4);

    assert.equal(updateResult.ok, false);
    assert.equal(updateResult.status, 409);
    assert.deepEqual(updateResult.body?.conflictFields, ["revision"]);
    assert.equal(updateResult.body?.workbench, "/roadmap/allocation/drafts");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["PATCH", "http://local.test/api/plan-inbox/inbox%2Fone"],
    ["POST", "http://local.test/api/plan-inbox/inbox%2Fone/convert"],
    ["POST", "http://local.test/api/plan-inbox/inbox%2Fone/dismiss"],
    ["POST", "http://local.test/api/plan-inbox/inbox%2Fone/reopen"],
  ]);
  assert.deepEqual(await Promise.all(requests.map((request) => request.json())), [
    {
      expectedRevision: 3,
      title: "Local draft",
      predecessorTasks: [{ taskId: "task-1", dependencyType: "HARD" }],
    },
    { expectedRevision: 3, idempotencyKey: "plan-inbox-convert-key" },
    { expectedRevision: 3 },
    { expectedRevision: 4 },
  ]);
});

test("planning adapters own milestone creation and rolling query encoding", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({ milestone: { id: "milestone-1" } });
  };

  try {
    await createPlanMilestone({
      idempotencyKey: "milestone-create-key",
      stagePlanId: "stage-1",
      expectedStagePlanRevision: 2,
      stableKey: "phase/one",
      title: "Phase one",
      subjectId: null,
    });
    await getPlanRolling({
      date: "2026-08-21",
      subjectId: "subject/one",
      status: "todo",
      q: "linear algebra",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["POST", "http://local.test/api/plan-milestones"],
    ["GET", "http://local.test/api/plan/rolling?date=2026-08-21&subjectId=subject%2Fone&status=todo&q=linear+algebra"],
  ]);
  assert.deepEqual(await requests[0]?.json(), {
    idempotencyKey: "milestone-create-key",
    stagePlanId: "stage-1",
    expectedStagePlanRevision: 2,
    stableKey: "phase/one",
    title: "Phase one",
    subjectId: null,
  });
  assert.equal(requests[1]?.headers.get("cache-control"), null);
});

test("task and milestone adapters preserve conflict and workbench metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("plan-milestones")
    ? Response.json({
        error: "STAGE_PLAN_NOT_FOUND",
        workbench: "/roadmap/stages",
      }, { status: 404 })
    : Response.json({
        error: "TASK_UPDATED_AT_CONFLICT",
        latest: { id: "task-1", status: "todo", updatedAt: "2026-08-21T01:00:00.000Z" },
        conflictFields: ["updatedAt"],
        workbench: "/roadmap/allocation",
      }, { status: 409 });

  try {
    const taskResult = await updateTask("task-1", {
      expectedStatus: "todo",
      expectedUpdatedAt: "2026-08-21T00:00:00.000Z",
      title: "Local title",
    });
    const milestoneResult = await createPlanMilestone({
      stagePlanId: "missing-stage",
      stableKey: "phase-one",
      title: "Phase one",
    });

    assert.equal(taskResult.status, 409);
    assert.deepEqual(taskResult.body?.conflictFields, ["updatedAt"]);
    assert.deepEqual(taskResult.body?.latest, {
      id: "task-1",
      status: "todo",
      updatedAt: "2026-08-21T01:00:00.000Z",
    });
    assert.equal(taskResult.body?.workbench, "/roadmap/allocation");

    assert.equal(milestoneResult.status, 404);
    assert.equal(milestoneResult.body?.error, "STAGE_PLAN_NOT_FOUND");
    assert.equal(milestoneResult.body?.workbench, "/roadmap/stages");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
