import assert from "node:assert/strict";
import test from "node:test";
import {
  isResourceDetailDraft,
  isStoredResourceDetailDraft,
  restoreResourceDetailDraft,
  type ResourceDetailValues,
} from "./study-resource-detail-draft";

const values: ResourceDetailValues = {
  title: "操作系统讲义",
  category: "TEXTBOOK",
  subjectId: "subject-1",
  tags: "重点",
  taskIds: ["task-1"],
  noteIds: [],
  mistakeIds: [],
  syllabusNodeIds: ["node-1"],
};

test("resource detail draft restores only a matching revision as current", () => {
  const stored = { schemaVersion: 1 as const, baseRevision: 4, values };

  assert.equal(isResourceDetailDraft(stored), true);
  assert.deepEqual(restoreResourceDetailDraft(stored, 4), {
    status: "current",
    baseRevision: 4,
    values,
  });
  assert.deepEqual(restoreResourceDetailDraft(stored, 5), {
    status: "stale",
    baseRevision: 4,
    values,
  });
});

test("legacy resource detail values remain readable but have no submit baseline", () => {
  assert.equal(isStoredResourceDetailDraft(values), true);
  assert.equal(isResourceDetailDraft(values), false);
  assert.deepEqual(restoreResourceDetailDraft(values, 8), {
    status: "legacy",
    baseRevision: null,
    values,
  });
});

test("resource detail draft rejects malformed revisions and value arrays", () => {
  assert.equal(isStoredResourceDetailDraft({ schemaVersion: 1, baseRevision: -1, values }), false);
  assert.equal(isStoredResourceDetailDraft({ schemaVersion: 1, baseRevision: 1.5, values }), false);
  assert.equal(isStoredResourceDetailDraft({ ...values, taskIds: [1] }), false);
});
