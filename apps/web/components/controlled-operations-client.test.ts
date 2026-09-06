import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.dirname(fileURLToPath(import.meta.url));

test("controlled operations UI stays typed, operator-gated, and execution-free", async () => {
  const source = await readFile(path.join(root, "controlled-operations-client.tsx"), "utf8");
  assert.match(source, /props\.enabled/);
  for (const action of [
    "listControlledOperations",
    "listControlledOperationRequests",
    "createControlledOperationRequest",
    "confirmControlledOperationRequest",
    "approveControlledOperationRequest",
    "cancelControlledOperationRequest",
    "holdControlledOperationRequest",
    "resumeControlledOperationRequest",
    "retryControlledOperationRequest",
  ]) assert.match(source, new RegExp(action));
  assert.match(source, /expectedBeforeHash/);
  assert.match(source, /requestHash/);
  assert.match(source, /nonce/);
  assert.match(source, /root-only agent/);
  assert.match(source, /不执行服务器命令/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /exec\(|spawn\(|child_process|docker/);
  assert.doesNotMatch(source, /<button\b|<input\b|<select\b|<textarea\b/);
});
