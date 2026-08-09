import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateVisibleActionCount, getWorkbenchBreadcrumbActions } from "@/components/workbench-breadcrumb-actions";

function labels(pathname: string, currentHref?: string): string[] {
  return getWorkbenchBreadcrumbActions(pathname, currentHref).map((action) => action.label);
}

test("low-frequency knowledge tools keep their own page actions", () => {
  assert.deepEqual(labels("/knowledge/imports"), ["开始导入", "导出学习树"]);
  assert.deepEqual(labels("/knowledge/imports", "/knowledge/imports?mode=import"), ["导入历史", "导出学习树"]);
  assert.deepEqual(labels("/knowledge/canvas"), []);
});

test("settings data does not duplicate its content links in the page toolbar", () => {
  assert.deepEqual(labels("/settings/data"), []);
});

test("page actions use the available toolbar width instead of a fixed count", () => {
  assert.equal(calculateVisibleActionCount(600, [120, 120, 120], 80), 3);
  assert.equal(calculateVisibleActionCount(330, [120, 120, 120], 80), 1);
  assert.equal(calculateVisibleActionCount(140, [120], 80), 1);
});
