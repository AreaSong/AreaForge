import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { TASK_TYPES } from "@areaforge/core";
import { createTaskSchema, updateTaskSchema } from "./schemas";

function loadSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function taskInput(type: string) {
  return {
    idempotencyKey: "task-type-contract-1",
    subjectId: "subject-1",
    title: "目录契约测试任务",
    type,
  };
}

test("task type catalog is shared by create/update schemas with explicit legacy compatibility", () => {
  for (const type of TASK_TYPES) {
    assert.equal(createTaskSchema.safeParse(taskInput(type)).success, true, `${type} 应允许新建`);
  }

  assert.equal(createTaskSchema.safeParse(taskInput("focus")).success, false);
  assert.equal(createTaskSchema.safeParse(taskInput("custom")).success, false);
  assert.equal(updateTaskSchema.safeParse({ expectedStatus: "todo", expectedUpdatedAt: new Date().toISOString(), type: "focus" }).success, true);
  assert.equal(updateTaskSchema.safeParse({ expectedStatus: "todo", expectedUpdatedAt: new Date().toISOString(), type: "custom" }).success, false);
});

test("stage plan form consumes versioned templates as editable form seeds", () => {
  const source = loadSource("components/stage-plan-create-form.tsx");

  assert.match(source, /listStageTemplates/);
  assert.match(source, /STAGE_TEMPLATE_CATALOG_VERSION/);
  assert.match(source, /setName\(template\.name\)/);
  assert.match(source, /setGoal\(template\.goal\)/);
  assert.match(source, /setMode\(template\.mode\)/);
  assert.match(source, /template\.durationDays - 1/);
  assert.match(source, /请先填写有效的阶段开始日期/);
  assert.match(source, /提交前不会写入/);
  assert.doesNotMatch(source, /createStagePlan\([^)]*template/);
});

test("task creation surfaces consume the shared task type definitions", () => {
  const surfaces = [
    "components/task-panel.tsx",
    "components/plan-rolling-create-drawer.tsx",
    "components/task-detail-editor.tsx",
  ];

  for (const surface of surfaces) {
    const source = loadSource(surface);
    assert.match(source, /TASK_TYPE_DEFINITIONS/, `${surface} 应读取共享任务类型目录`);
    assert.doesNotMatch(source, /<option value="(study|review|practice|mistake|simulation_exam)"/);
  }
});

test("resource API, service and UI consume the shared resource category catalog", () => {
  const apiRoutes = [
    "app/api/study-resources/[id]/route.ts",
    "app/api/study-resources/from-attachment/route.ts",
    "app/api/study-resources/uploads/resolve/route.ts",
    "app/api/study-resources/links/route.ts",
  ];

  for (const route of apiRoutes) {
    assert.match(loadSource(route), /z\.enum\(STUDY_RESOURCE_CATEGORIES\)/, `${route} 应读取共享资料分类目录`);
  }

  assert.match(loadSource("lib/study/study-resource-service.ts"), /isStudyResourceCategory/);
  assert.match(loadSource("components/study-resource-workbench-support.ts"), /STUDY_RESOURCE_CATEGORY_OPTIONS/);
  assert.match(loadSource("components/study-resource-detail-client-parts.tsx"), /STUDY_RESOURCE_CATEGORY_OPTIONS/);
  assert.match(loadSource("components/study-resource-card.tsx"), /getStudyResourceCategoryLabel/);
});
