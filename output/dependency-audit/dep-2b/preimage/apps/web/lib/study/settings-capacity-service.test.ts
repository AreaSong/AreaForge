import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyCapacityMetrics, getWorkspaceCapacityMetrics } from "./settings-capacity-service";

test("createEmptyCapacityMetrics returns stable zero-initialized metrics", () => {
  const empty = createEmptyCapacityMetrics();
  assert.equal(empty.activeSubjectCount, 0);
  assert.equal(empty.syllabusNodeCount, 0);
  assert.equal(empty.knowledgePointCount, 0);
  assert.equal(empty.noteCount, 0);
  assert.equal(empty.mistakeCount, 0);
  assert.equal(empty.sessionCount, 0);
  assert.equal(empty.totalSessionHoursFormatted, "0.0 h");
  assert.equal(empty.attachmentCount, 0);
  assert.equal(empty.totalAttachmentBytes, 0);
  assert.equal(empty.totalAttachmentBytesFormatted, "0 B");
});

test("getWorkspaceCapacityMetrics returns empty metrics when workspaceId is null or undefined", async () => {
  const metrics = await getWorkspaceCapacityMetrics("actor-1", null);
  assert.equal(metrics.activeSubjectCount, 0);
  assert.equal(metrics.attachmentCount, 0);
});
