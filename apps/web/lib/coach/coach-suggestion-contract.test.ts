import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Coach suggestion routes keep the confirmation chain explicit", async () => {
  const [collection, item] = await Promise.all([
    readFile(path.join(webRoot, "app/api/coach/suggestions/route.ts"), "utf8"),
    readFile(path.join(webRoot, "app/api/coach/suggestions/[id]/route.ts"), "utf8"),
  ]);
  assert.match(collection, /requireApiUser\(request\)/);
  assert.match(item, /expectedRevision/);
  assert.match(item, /z\.enum\(\["accept", "reject", "revoke"\]\)/);
  assert.doesNotMatch(collection, /StudyTask|StagePlan/);
  assert.doesNotMatch(item, /StudyTask|StagePlan/);
});
