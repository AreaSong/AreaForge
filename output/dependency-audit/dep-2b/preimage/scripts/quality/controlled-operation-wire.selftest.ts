import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { bindControlledOperation, operationContextHash, operationExpectedBeforeHash, operationIntentHash, type OperationExecutionContext, type OperationParameters } from "../../packages/db/src/index";
import { loadProductionOperationConfig } from "../../ops/controlled-operation-agent/production-driver";
import { validateRootDispatchReceipt, RootOperationNoEffectRejection } from "../../ops/controlled-operation-agent/result";

const hash = `sha256:${"a".repeat(64)}`;
const context: OperationExecutionContext = { schemaVersion: 1, environment: "local_fixture", scopeId: hash, observedAt: new Date().toISOString(), snapshotHash: "",
  expectedBefore: { currentVersion: "9.9.0", currentImage: `ghcr.io/areasong/areaforge-web:v9.9.0@${hash}`, autoApply: "none", signatureRequired: true,
    rollbackAvailable: true, rollbackTargetVersion: "9.8.9", rollbackTargetImage: `ghcr.io/areasong/areaforge-web:v9.8.9@${hash}`, rollbackSourceRecordSha256: hash },
  target: { releaseId: 1, manifestSha256: hash, manifestVersion: "9.9.1", webImageDigest: `ghcr.io/areasong/areaforge-web:v9.9.1@${hash}` } };
context.snapshotHash = operationContextHash(context);
for (const operation of [{ operation: "APPLY_RELEASE", tag: "v9.9.1" }, { operation: "ROLLBACK_RELEASE", targetVersion: "9.8.9" }, { operation: "CHECK_RELEASE", tag: null }] as OperationParameters[]) {
  const intent = { operation, requestedReason: "fixture", expectedBeforeHash: operationExpectedBeforeHash(context.expectedBefore), executionSnapshotHash: context.snapshotHash,
    idempotencyKey: "11111111-1111-4111-8111-111111111111" };
  const risk = operation.operation === "CHECK_RELEASE" ? "READ_ONLY" : "HIGH_RISK";
  const bound = bindControlledOperation({ id: "opreq_fixture", actorId: "operator", actorEmail: "operator@example.test", intent,
    descriptor: { code: operation.operation, risk, requiresApproval: risk === "HIGH_RISK" }, intentHash: operationIntentHash("operator", intent),
    nonce: "22222222-2222-4222-8222-222222222222", requestedAt: context.observedAt,
    expiresAt: new Date(Date.parse(context.observedAt) + (risk === "HIGH_RISK" ? 300_000 : 900_000)).toISOString(), context });
  // Linux 的 Node pipe 可能是 socket，重开 /dev/stdin 会 ENXIO；让 jq 直接读 fd 0。
  execFileSync("bash", ["-c", 'source "$1"; validate_request_schema -', "ops-wire-selftest", path.resolve("ops/update-agent/lib/update-request-v2.sh")],
    { env: { PATH: process.env.PATH }, input: JSON.stringify(bound.execution.updaterRequest), stdio: ["pipe", "pipe", "pipe"] });
}
delete process.env.OPS_AGENT_PRODUCTION_ENABLED;
await assert.rejects(loadProductionOperationConfig("/not-read-by-disabled-agent"), /OPS_PRODUCTION_DISABLED/);
assert.equal(spawnSync("bash", ["ops/controlled-operation-agent/dispatch.sh", "observe"], { env: { PATH: process.env.PATH } }).status, 77);
const rejected = { outcome: "REJECTED", requestHash: hash, evidenceHash: hash, executionAttempted: false, reasonCode: "PRODUCTION_STATE_LOCK_BUSY" };
assert.throws(() => validateRootDispatchReceipt(rejected, hash, true), error => error instanceof RootOperationNoEffectRejection && error.reasonCode === "PRODUCTION_STATE_LOCK_BUSY");
for (const altered of [{ ...rejected, executionAttempted: null }, { ...rejected, executionAttempted: true }, { ...rejected, arbitraryPath: "/tmp" }]) {
  assert.throws(() => validateRootDispatchReceipt(altered, hash, true), error => error instanceof Error && !(error instanceof RootOperationNoEffectRejection));
}
assert.equal(validateRootDispatchReceipt({ ...rejected, outcome: "SUCCEEDED", executionAttempted: true }, hash, true), hash);
console.log("PASS frozen wire passes the original strict shell schema; production entry is default-off before reading config");
