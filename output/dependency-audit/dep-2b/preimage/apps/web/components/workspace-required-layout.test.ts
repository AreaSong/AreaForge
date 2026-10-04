import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const componentsRoot = path.dirname(fileURLToPath(import.meta.url));

test("workspace-required routes accept an active member selection without restoring owner-only access", async () => {
  const source = await readFile(path.join(componentsRoot, "workspace-required-layout.tsx"), "utf8");
  assert.match(source, /findSelectedMemberWorkspaceOrNull\(user\.id\)/);
  assert.doesNotMatch(source, /findActiveWorkspaceOrNull/);
});
