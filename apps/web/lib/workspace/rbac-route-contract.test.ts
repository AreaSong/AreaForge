import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("role updates exclude OWNER and require authenticated actor plus revision", async () => {
  const source = await readFile(
    path.join(webRoot, "app/api/exam-workspaces/[id]/members/[membershipId]/role/route.ts"),
    "utf8",
  );
  assert.match(source, /requireApiUser\(request\)/);
  assert.match(source, /z\.enum\(\["ADMIN", "COACH", "MEMBER", "VIEWER"\]\)/);
  assert.doesNotMatch(source, /z\.enum\(\[[^\]]*"OWNER"/);
  assert.match(source, /expectedRevision/);
});
