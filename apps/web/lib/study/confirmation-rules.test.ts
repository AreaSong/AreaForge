import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiConfirmationCapability,
  isSimulationReadyForConfirmation,
  periodicReportConfirmationId,
  retestConfirmationActionReady,
  retestConfirmationStatus,
  simulationConfirmationActionReady,
} from "@/lib/study/confirmation-rules";

test("periodic report confirmation ids are stable for the same period boundary", () => {
  assert.equal(periodicReportConfirmationId("week", "2026-08-02"), "report:week:2026-08-02");
  assert.equal(periodicReportConfirmationId("month", "2026-07-31"), "report:month:2026-07-31");
});

test("incomplete simulations never become confirmation items", () => {
  const base = {
    status: "DRAFT" as const,
    subjectResultCount: 1,
    summary: "考后总结",
    reviewText: "结构化复盘",
    mindset: "时间分配紧张",
  };
  assert.equal(isSimulationReadyForConfirmation(base), true);
  assert.equal(simulationConfirmationActionReady(base), true);
  assert.equal(isSimulationReadyForConfirmation({ ...base, summary: " " }), false);
  assert.equal(isSimulationReadyForConfirmation({ ...base, reviewText: null }), false);
  assert.equal(isSimulationReadyForConfirmation({ ...base, mindset: "" }), false);
  assert.equal(isSimulationReadyForConfirmation({ ...base, subjectResultCount: 0 }), false);
  assert.equal(isSimulationReadyForConfirmation({ ...base, status: "CONFIRMED" }), true);
  assert.equal(simulationConfirmationActionReady({ ...base, status: "CONFIRMED" }), false);
});

test("only submitted retests enter pending confirmation", () => {
  assert.equal(retestConfirmationStatus("DRAFT"), null);
  assert.equal(retestConfirmationStatus("IN_PROGRESS"), null);
  assert.equal(retestConfirmationStatus("PENDING_REVIEW"), "PENDING");
  assert.equal(retestConfirmationStatus("CLOSED"), "FROZEN");
  assert.equal(retestConfirmationStatus("VOIDED"), "REJECTED");
  assert.equal(retestConfirmationActionReady("PENDING_REVIEW"), true);
  assert.equal(retestConfirmationActionReady("IN_PROGRESS"), false);
});

test("AI confirmation always requires the source page proof", () => {
  assert.deepEqual(aiConfirmationCapability(), { canExecute: false, requiresSourceProof: true });
});
