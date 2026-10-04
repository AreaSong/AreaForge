import assert from "node:assert/strict";
import test from "node:test";
import {
  getControlledOperationDescriptor,
  listControlledOperations,
  parseControlledOperationIntent,
} from "./controlled-operation";

const hash = `sha256:${"a".repeat(64)}`;

test("controlled operation catalog contains only typed root-agent actions", () => {
  const catalog = listControlledOperations();
  assert.equal(catalog.length, 6);
  assert.equal(catalog.some((item) => item.executionOwner === "WEB_PREVIEW"), false);
  assert.equal(catalog.filter((item) => item.risk === "HIGH_RISK").every((item) => item.requiresApproval), true);
});
test("controlled operation intent accepts strict typed parameters", () => {
  const intent = parseControlledOperationIntent({
    operation: { operation: "APPLY_RELEASE", tag: "v1.3.0" },
    expectedBeforeHash: hash,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    requestedReason: "按已确认的 Release 窗口执行",
  });
  assert.equal(intent?.operation.operation, "APPLY_RELEASE");
});

test("controlled operation intent rejects command text, free paths, and unknown fields", () => {
  assert.equal(parseControlledOperationIntent({
    operation: { operation: "APPLY_RELEASE", tag: "v1.3.0", command: "docker rm -f x" },
    expectedBeforeHash: hash,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    requestedReason: "bad",
  }), null);
  assert.equal(parseControlledOperationIntent({
    operation: { operation: "BACKUP_PREVIEW", scope: "FULL", path: "/var/lib" },
    expectedBeforeHash: hash,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    requestedReason: "bad",
  }), null);
});

test("operation descriptor is copied and cannot mutate the catalog", () => {
  const first = getControlledOperationDescriptor("DIAGNOSTIC_HEALTH");
  first.label = "changed";
  assert.equal(getControlledOperationDescriptor("DIAGNOSTIC_HEALTH").label, "读取脱敏健康摘要");
});
