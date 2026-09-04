import assert from "node:assert/strict";
import test from "node:test";
import { selectAuthenticatedEntryRoute } from "@/lib/navigation/app-entry";

test("authenticated entry sends an incomplete workspace to setup", () => {
  assert.equal(
    selectAuthenticatedEntryRoute({ hasWorkspace: false, activeSession: null }),
    "/settings/exams?setup=1",
  );
});

test("authenticated entry defaults to today's decision surface", () => {
  assert.equal(
    selectAuthenticatedEntryRoute({ hasWorkspace: true, activeSession: null }),
    "/today",
  );
});

test("authenticated entry restores each active activity at its source", () => {
  assert.equal(selectAuthenticatedEntryRoute({
    hasWorkspace: true,
    activeSession: {
      activityMode: "FREE_STUDY",
      reviewScheduleId: null,
      knowledgeRetestId: null,
      simulationExamId: null,
    },
  }), "/focus");
  assert.equal(selectAuthenticatedEntryRoute({
    hasWorkspace: true,
    activeSession: {
      activityMode: "KNOWLEDGE_REVIEW",
      reviewScheduleId: "review-1",
      knowledgeRetestId: null,
      simulationExamId: null,
    },
  }), "/knowledge/reviews/review-1/run");
  assert.equal(selectAuthenticatedEntryRoute({
    hasWorkspace: true,
    activeSession: {
      activityMode: "RETEST",
      reviewScheduleId: null,
      knowledgeRetestId: "retest-1",
      simulationExamId: null,
    },
  }), "/test/retests/retest-1");
  assert.equal(selectAuthenticatedEntryRoute({
    hasWorkspace: true,
    activeSession: {
      activityMode: "SIMULATION",
      reviewScheduleId: null,
      knowledgeRetestId: null,
      simulationExamId: "simulation-1",
    },
  }), "/test/simulations/simulation-1");
});
