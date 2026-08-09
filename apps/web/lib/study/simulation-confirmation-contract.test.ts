import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const sourcePath = resolve(process.cwd(), "components/simulation-detail-client.tsx");

test("simulation source page routes complete results to confirmation center", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.match(source, /href=\"\/confirmations\"/);
  assert.match(source, /readyForConfirmation/);
  assert.match(source, /draftReady/);
  assert.match(source, /hasUnsavedChanges/);
  assert.doesNotMatch(source, /fetch\([^\n]*simulation-exams[^\n]*\/confirm/);
  assert.doesNotMatch(source, /function\s+confirmExam\b/);
});
