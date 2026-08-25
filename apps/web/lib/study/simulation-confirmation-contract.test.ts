import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const controllerPath = resolve(process.cwd(), "components/simulation-detail-client.tsx");
const workspacePath = resolve(process.cwd(), "components/simulation-detail-workspace.tsx");

test("simulation source page routes complete results to confirmation center", () => {
  const controller = readFileSync(controllerPath, "utf8");
  const workspace = readFileSync(workspacePath, "utf8");

  assert.match(workspace, /href=\"\/confirmations\"/);
  assert.match(workspace, /readyForConfirmation/);
  assert.match(controller, /draftReady/);
  assert.match(controller, /hasUnsavedChanges/);
  assert.doesNotMatch(controller, /fetch\([^\n]*simulation-exams[^\n]*\/confirm/);
  assert.doesNotMatch(workspace, /fetch\([^\n]*simulation-exams[^\n]*\/confirm/);
  assert.doesNotMatch(controller, /function\s+confirmExam\b/);
  assert.doesNotMatch(workspace, /function\s+confirmExam\b/);
});
