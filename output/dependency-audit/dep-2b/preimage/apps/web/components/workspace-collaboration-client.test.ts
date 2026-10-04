import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "workspace-collaboration-client.tsx");

test("collaboration resource candidates load only for actors allowed to manage their grants", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /canManageShares \? listWorkspaceShareGrants/);
  assert.match(source, /canManageShares \? listOwnedNotes/);
  assert.match(source, /canManageShares \? listOwnedMistakes/);
  assert.match(source, /listSharedWithMe\(\)/);
  assert.match(source, /listCoachSuggestions\(props\.workspaceId\)/);
  assert.match(source, /member\.userId !== props\.currentUserId/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});
