import assert from "node:assert/strict";
import test from "node:test";
import { bindControlledOperation, boundOperationRequestHash, operationContextHash, operationExpectedBeforeHash, operationIntentHash, parseBoundOperation, parseOperationContext, parseOperationParameters, type OperationExecutionContext, type OperationParameters } from "./controlled-operation-protocol";
import { buildUpdateRequestV2, computeStatusSnapshotHash } from "../../../apps/web/lib/system/update-request-v2";

const hash = `sha256:${"a".repeat(64)}`;
function context(): OperationExecutionContext {
  const value: OperationExecutionContext = { schemaVersion: 1, environment: "local_fixture", scopeId: hash, observedAt: "2026-09-14T00:00:00.000Z", snapshotHash: "",
    expectedBefore: { currentVersion: "1.2.0", currentImage: `ghcr.io/areasong/areaforge-web:v1.2.0@${hash}`, autoApply: "none", signatureRequired: true,
      rollbackAvailable: true, rollbackTargetVersion: "1.1.1", rollbackTargetImage: `ghcr.io/areasong/areaforge-web:v1.1.1@${hash}`, rollbackSourceRecordSha256: hash },
    target: { releaseId: 42, manifestSha256: hash, manifestVersion: "1.3.0", webImageDigest: `ghcr.io/areasong/areaforge-web:v1.3.0@${hash}` } };
  value.snapshotHash = operationContextHash(value); return value;
}
function bind(parameters: OperationParameters, current = context()) {
  const intent = { operation: parameters, expectedBeforeHash: operationExpectedBeforeHash(current.expectedBefore), idempotencyKey: "11111111-1111-4111-8111-111111111111", requestedReason: "合成确认", executionSnapshotHash: current.snapshotHash };
  const risk = ["APPLY_RELEASE", "ROLLBACK_RELEASE", "MAINTENANCE_HOLD"].includes(parameters.operation) ? "HIGH_RISK" : "READ_ONLY";
  return bindControlledOperation({ id: "opreq_test", actorId: "operator", actorEmail: "operator@example.test", intent, context: current,
    descriptor: { code: parameters.operation, risk, requiresApproval: risk === "HIGH_RISK" }, intentHash: operationIntentHash("operator", intent),
    nonce: "22222222-2222-4222-8222-222222222222", requestedAt: "2026-09-14T00:00:00.000Z", expiresAt: risk === "HIGH_RISK" ? "2026-09-14T00:05:00.000Z" : "2026-09-14T00:15:00.000Z" });
}
test("OPS 严格绑定拒绝任意参数、未知字段和缺少前态的旧 intent", () => {
  assert.equal(parseOperationParameters({ operation: "DIAGNOSTIC_HEALTH", includeCapacity: false, command: "anything" }), null);
  assert.equal(parseBoundOperation({ operation: "APPLY_RELEASE", tag: "v1.3.0" }), null);
  assert.equal(parseOperationContext({ ...context(), path: "/tmp" }), null);
  assert.equal(parseOperationContext({ ...context(), scopeId: `sha256:${"b".repeat(64)}` }), null);
});
test("六个白名单操作都固定完整身份，不能篡改 nonce/初始 revision/期望状态", () => {
  const parameters: OperationParameters[] = [{ operation: "CHECK_RELEASE", tag: "v1.3.0" }, { operation: "BACKUP_PREVIEW", scope: "FULL" },
    { operation: "DIAGNOSTIC_HEALTH", includeCapacity: true }, { operation: "APPLY_RELEASE", tag: "v1.3.0" },
    { operation: "ROLLBACK_RELEASE", targetVersion: "1.1.1" }, { operation: "MAINTENANCE_HOLD", reasonCode: "RELEASE" }];
  for (const operation of parameters) {
    const bound = bind(operation); assert.ok(parseBoundOperation(bound)); assert.match(boundOperationRequestHash(bound), /^sha256:[a-f0-9]{64}$/);
    for (const key of ["nonce", "initialRevision", "originalRequestHash"]) {
      const changed = structuredClone(bound); Object.assign(changed.execution, { [key]: "changed" }); assert.equal(parseBoundOperation(changed), null);
    }
  }
});
test("冻结 wire 与旧 updater V2 的三种 domain-separated hash 完全一致", () => {
  for (const parameters of [{ operation: "CHECK_RELEASE", tag: null }, { operation: "APPLY_RELEASE", tag: "v1.3.0" }, { operation: "ROLLBACK_RELEASE", targetVersion: "1.1.1" }] as OperationParameters[]) {
    const bound = bind(parameters); const wire = bound.execution.updaterRequest!; const before = context().expectedBefore;
    const snapshot = { snapshotSchemaVersion: 2 as const, snapshotHash: "", currentVersion: before.currentVersion, currentImage: before.currentImage,
      autoApply: before.autoApply, signatureRequired: before.signatureRequired, verifiedTarget: context().target,
      rollback: { available: before.rollbackAvailable, targetVersion: before.rollbackTargetVersion, targetImage: before.rollbackTargetImage, sourceRecordSha256: before.rollbackSourceRecordSha256 } };
    snapshot.snapshotHash = computeStatusSnapshotHash(snapshot);
    const command = wire.action === "apply" ? { action: "apply" as const, tag: "v1.3.0", idempotencyKey: wire.idempotencyKey, confirmedSnapshotHash: snapshot.snapshotHash }
      : { action: wire.action, idempotencyKey: wire.idempotencyKey, confirmedSnapshotHash: snapshot.snapshotHash };
    assert.deepEqual(wire, buildUpdateRequestV2({ command, actorEmail: "operator@example.test", snapshot, now: new Date(wire.requestedAt), id: wire.id }));
  }
});
test("apply/rollback 拒绝未签名、错版本、非递增版本、缺少固定回滚与错误镜像 tag", () => {
  for (const mutate of [
    (value: OperationExecutionContext) => { value.expectedBefore.signatureRequired = false; },
    (value: OperationExecutionContext) => { value.target!.manifestVersion = "1.2.0"; },
    (value: OperationExecutionContext) => { value.target!.releaseId = Number.MAX_SAFE_INTEGER + 1; },
    (value: OperationExecutionContext) => { value.target!.webImageDigest = "latest"; },
  ]) {
    const value = context(); mutate(value);
    assert.throws(() => { value.snapshotHash = operationContextHash(value); bind({ operation: "APPLY_RELEASE", tag: "v1.3.0" }, value); });
  }
  assert.throws(() => bind({ operation: "ROLLBACK_RELEASE", targetVersion: "1.0.0" }));
});
