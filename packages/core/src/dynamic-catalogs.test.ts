import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getStageTemplate,
  getStudyResourceCategoryLabel,
  getTaskTypeLabel,
  isStudyResourceCategory,
  isSupportedTaskType,
  isTaskType,
  listStageTemplates,
  STAGE_TEMPLATE_CATALOG_VERSION,
  STUDY_RESOURCE_CATEGORIES,
  STUDY_RESOURCE_CATEGORY_OPTIONS,
  TASK_TYPES,
  TASK_TYPE_DEFINITIONS,
} from "./index";

test("stage templates are versioned editable seeds with unique identities", () => {
  const templates = listStageTemplates();
  assert.match(STAGE_TEMPLATE_CATALOG_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(templates.length, 6);
  assert.equal(new Set(templates.map((template) => template.id)).size, templates.length);
  assert.ok(templates.every((template) => template.version && template.durationDays > 0));
  assert.equal(getStageTemplate("systematic-strengthening")?.mode, "strengthen");
  assert.equal(getStageTemplate("missing"), null);
});

test("task type catalog separates selectable values from the legacy focus alias", () => {
  assert.deepEqual(TASK_TYPE_DEFINITIONS.map((item) => item.value), [...TASK_TYPES]);
  assert.equal(isTaskType("study"), true);
  assert.equal(isTaskType("focus"), false);
  assert.equal(isSupportedTaskType("focus"), true);
  assert.equal(isSupportedTaskType("custom"), false);
  assert.equal(getTaskTypeLabel("focus"), "学习");
  assert.equal(getTaskTypeLabel("custom"), "custom");
});

test("study resource category values and labels stay one-to-one", () => {
  assert.deepEqual(STUDY_RESOURCE_CATEGORY_OPTIONS.map((item) => item.value), [...STUDY_RESOURCE_CATEGORIES]);
  assert.equal(isStudyResourceCategory("PAST_PAPER"), true);
  assert.equal(isStudyResourceCategory("BOOK"), false);
  assert.equal(getStudyResourceCategoryLabel("SUMMARY"), "总结/速查");
});
