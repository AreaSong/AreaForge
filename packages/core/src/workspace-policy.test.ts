import assert from "node:assert/strict";
import test from "node:test";
import { EXAM_WORKSPACE_DEFAULTS, EXAM_WORKSPACE_LIMITS } from "./workspace-policy";

test("workspace policy keeps setup defaults and limits in one shared contract", () => {
  assert.equal(EXAM_WORKSPACE_DEFAULTS.name.length > 0, true);
  assert.equal(EXAM_WORKSPACE_DEFAULTS.stableKeyPrefix, "workspace");
  assert.equal(EXAM_WORKSPACE_LIMITS.maxInitialSubjects, 12);
  assert.equal(EXAM_WORKSPACE_LIMITS.maxInitialGroups, 20);
});
