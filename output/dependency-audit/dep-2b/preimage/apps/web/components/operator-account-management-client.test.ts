import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "operator-account-management-client.tsx");

test("operator account UI stays redacted, reauthenticated and two-step confirmed", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /maskedEmail/);
  assert.match(source, /reauthenticate\(password\)/);
  assert.match(source, /armedKey !== key/);
  assert.match(source, /expectedAuthRevision: account\.authRevision/);
  assert.match(source, /OPERATOR|Operator/);
  assert.doesNotMatch(source, /account\.email\b|passwordHash|\bfetch\s*\(/);
});
