import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(webRoot, relativePath), "utf8");
}

test("share grant routes derive actors from authenticated server sessions", async () => {
  const [collection, item, shared] = await Promise.all([
    source("app/api/exam-workspaces/[id]/share-grants/route.ts"),
    source("app/api/exam-workspaces/[id]/share-grants/[grantId]/route.ts"),
    source("app/api/shared-with-me/route.ts"),
  ]);
  for (const route of [collection, item, shared]) {
    assert.match(route, /requireApiUser\(request\)/);
    assert.doesNotMatch(route, /actorId:\s*z\./);
  }
  assert.match(collection, /z\.enum\(\["NOTE", "MISTAKE", "ATTACHMENT"\]\)/);
  assert.doesNotMatch(collection, /DAILY_REVIEW|MOTIVATION|AI_DRAFT/);
  assert.match(item, /expectedRevision/);
});
