import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  controlledOperationHoldSchema,
  controlledOperationRequestBindingSchema,
  computeControlledOperationIntentHash,
} from "./controlled-operation-request-service";
import { parseControlledOperationIntent } from "./controlled-operation";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = `sha256:${"a".repeat(64)}`;
const nonce = "11111111-1111-4111-8111-111111111111";

test("request binding is strict and hash/nonce bound", () => {
  const valid = { expectedRevision: 1, requestHash: hash, nonce };
  assert.equal(controlledOperationRequestBindingSchema.safeParse(valid).success, true);
  assert.equal(controlledOperationRequestBindingSchema.safeParse({ ...valid, command: "docker rm -f" }).success, false);
  assert.equal(controlledOperationRequestBindingSchema.safeParse({ ...valid, requestHash: "not-a-hash" }).success, false);
  assert.equal(controlledOperationHoldSchema.safeParse({ ...valid, reasonCode: "INCIDENT" }).success, true);
  assert.equal(controlledOperationHoldSchema.safeParse({ ...valid, reasonCode: "free text" }).success, false);
});

test("intent hash is canonical and actor-bound", () => {
  const intent = parseControlledOperationIntent({
    operation: { operation: "DIAGNOSTIC_HEALTH", includeCapacity: false },
    expectedBeforeHash: hash,
    idempotencyKey: nonce,
    requestedReason: "读取脱敏健康摘要",
  });
  assert.ok(intent);
  assert.equal(computeControlledOperationIntentHash("operator-a", intent), computeControlledOperationIntentHash("operator-a", {
    ...intent,
    operation: { includeCapacity: false, operation: "DIAGNOSTIC_HEALTH" },
  }));
  assert.notEqual(computeControlledOperationIntentHash("operator-a", intent), computeControlledOperationIntentHash("operator-b", intent));
});

test("request routes remain operator-only and execution-free", async () => {
  const files = [
    "app/api/system/operations/requests/route.ts",
    "app/api/system/operations/requests/[requestId]/route.ts",
    "app/api/system/operations/requests/[requestId]/confirm/route.ts",
    "app/api/system/operations/requests/[requestId]/approve/route.ts",
    "app/api/system/operations/requests/[requestId]/cancel/route.ts",
    "app/api/system/operations/requests/[requestId]/hold/route.ts",
    "app/api/system/operations/requests/[requestId]/resume/route.ts",
    "app/api/system/operations/requests/[requestId]/retry/route.ts",
  ];
  const sources = await Promise.all(files.map((file) => readFile(path.join(root, file), "utf8")));
  for (const source of sources) {
    assert.match(source, /requireApiUser\(request\)/);
    assert.match(source, /requirePlatformOperator/);
    assert.doesNotMatch(source, /exec\(|spawn\(|docker|child_process|shell/i);
  }
});
