import assert from "node:assert/strict";
import { test } from "node:test";
import { getCanonicalRoute } from "@/lib/navigation/app-navigation";
import { CANONICAL_ROUTES } from "@/lib/navigation/canonical-routes";
import {
  DYNAMIC_ROUTE_PATTERNS,
  ROOT_ROUTES,
  WORKBENCH_ROOT_ROUTES,
  confirmationDetailRoute,
  getWorkbenchRootRoute,
  knowledgeCardDetailRoute,
  knowledgePointDetailRoute,
  knowledgeRetestDetailRoute,
  learningTreeImportDetailRoute,
  mistakeDetailRoute,
  periodicReportHistoryRoute,
  planInboxItemRoute,
  quickReviewRunRoute,
  reviewScheduleDetailRoute,
  simulationExamDetailRoute,
  studyResourceDetailRoute,
  studyResourcePreviewRoute,
  studyTaskDetailRoute,
  syllabusNodeDetailRoute,
  type DynamicDetailRoute,
} from "@/lib/navigation/route-helpers";

test("root routes retain the canonical application entry and workbench owners", () => {
  assert.deepEqual(ROOT_ROUTES, { public: "/", login: "/login", app: "/focus" });
  assert.deepEqual(WORKBENCH_ROOT_ROUTES, {
    focus: "/focus",
    today: "/today",
    knowledge: "/knowledge",
    test: "/test/retests",
    roadmap: "/roadmap",
    confirmations: "/confirmations",
    settings: "/settings",
  });
  assert.equal(getWorkbenchRootRoute("test"), "/test/retests");

  for (const [workbench, path] of Object.entries(WORKBENCH_ROOT_ROUTES)) {
    const route = getCanonicalRoute(path);
    assert.equal(route?.shell, "app", `${path} must stay in the application shell`);
    if (route?.shell === "app") assert.equal(route.workbench, workbench);
  }
});

test("dynamic detail constructors preserve every canonical path shape", () => {
  assert.deepEqual(
    new Set(Object.values(DYNAMIC_ROUTE_PATTERNS)),
    new Set(CANONICAL_ROUTES.filter((route) => route.path.includes("[")).map((route) => route.path)),
    "the canonical registry and constructor patterns must share one dynamic route source",
  );
  const routes: DynamicDetailRoute[] = [
    planInboxItemRoute("item-1"),
    studyTaskDetailRoute("task-1"),
    periodicReportHistoryRoute("decision-1"),
    knowledgeRetestDetailRoute("retest-1"),
    simulationExamDetailRoute("exam-1"),
    confirmationDetailRoute("confirmation-1"),
    quickReviewRunRoute("schedule-1"),
    knowledgePointDetailRoute("point-1"),
    learningTreeImportDetailRoute("import-1"),
    syllabusNodeDetailRoute("node-1"),
    knowledgeCardDetailRoute("note-1"),
    mistakeDetailRoute("mistake-1"),
    studyResourceDetailRoute("resource-1"),
    studyResourcePreviewRoute("resource-1"),
    reviewScheduleDetailRoute("schedule-1"),
  ];

  assert.deepEqual(routes, [
    "/roadmap/allocation/drafts/item-1",
    "/roadmap/allocation/tasks/task-1",
    "/roadmap/reviews/history/decision-1",
    "/test/retests/retest-1",
    "/test/simulations/exam-1",
    "/confirmations/confirmation-1",
    "/knowledge/reviews/schedule-1/run",
    "/knowledge/points/point-1",
    "/knowledge/imports/import-1",
    "/knowledge/syllabi/node-1",
    "/knowledge/cards/note-1",
    "/knowledge/mistakes/mistake-1",
    "/knowledge/resources/resource-1",
    "/knowledge/resources/resource-1/preview",
    "/knowledge/reviews/schedule-1",
  ]);

  for (const path of routes) {
    assert.ok(getCanonicalRoute(path), `${path} must resolve through the canonical registry`);
  }

  assert.equal(
    routes.length,
    CANONICAL_ROUTES.filter((route) => route.path.includes("[")).length,
    "every dynamic canonical route must retain a typed constructor",
  );
});

test("dynamic route ids stay within one encoded path segment", () => {
  assert.equal(studyTaskDetailRoute("task / one"), "/roadmap/allocation/tasks/task%20%2F%20one");
  assert.equal(confirmationDetailRoute("item?tab=1"), "/confirmations/item%3Ftab%3D1");
  assert.equal(studyResourcePreviewRoute("resource#page"), "/knowledge/resources/resource%23page/preview");
});
