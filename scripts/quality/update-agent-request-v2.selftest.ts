import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const agent = path.join(root, "ops/update-agent/areaforge-update-agent.sh");
const nowEpoch = 1_800_000_000;
const currentVersion = "0.1.7";
const currentImage = `ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}`;
const targetImage = `ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"b".repeat(64)}`;
const systemFlock = spawnSync("sh", ["-c", "command -v flock"], { encoding: "utf8" }).stdout.trim();

type Action = "check" | "apply" | "rollback" | "set_auto_apply";

function main(): void {
  testSnapshotAndCheck();
  testHashRejectionHasNoExecution();
  testLegacyMutationFailsClosed();
  testApplyUsesClaimedRequestGuard();
  testApplyGuardRejectionHasNoExecution();
  testIdempotentReplayDoesNotExecuteAgain();
  testIdempotentReplayPreservesRejectedTerminalState();
  testRollbackUsesExactSourceRecordUnderLock();
  testPolicySuccessUnderLock();
  testFirstComparisonMismatchHasNoSideEffects();
  testSecondComparisonDriftHasNoSideEffects();
  testInvalidRequestIdCannotEscapeHistory();
  testInvalidClaimIdCannotEscapeHistory();
  testActiveProcessingClaimBlocksQueue();
  testCrashAfterExecutionBoundaryNeedsReconciliation();
  testRealProductionLockContention();
  testStaleProcessingNeedsReconciliation();
  testMissingClaimMetadataNeedsReconciliation();
  console.log("update-agent request V2 selftest passed.");
}

function fixture(): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), "areaforge-agent-v2-"));
  const state = path.join(dir, "state");
  const records = path.join(dir, "records");
  const bin = path.join(dir, "bin");
  mkdirSync(path.join(state, "requests"), { recursive: true });
  mkdirSync(records, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const envFile = path.join(dir, "production.env");
  const composeFile = path.join(dir, "compose.yml");
  const configFile = path.join(dir, "updater.env");
  const updaterLog = path.join(dir, "updater.log");
  const updaterMode = path.join(dir, "updater.mode");
  const dockerLog = path.join(dir, "docker.log");
  const flockLog = path.join(dir, "flock.log");
  const productionLockMarker = path.join(dir, "production-lock-held");
  writeFileSync(envFile, `APP_VERSION=${currentVersion}\nAREAFORGE_IMAGE=${currentImage}\nAPP_URL=https://example.invalid\n`);
  writeFileSync(composeFile, "services: {}\n");
  writeFileSync(configFile, [
    `AREAFORGE_ENV_FILE=${envFile}`,
    `AREAFORGE_COMPOSE_FILE=${composeFile}`,
    `AREAFORGE_DEPLOY_DIR=${dir}`,
    `AREAFORGE_UPDATE_RECORD_DIR=${records}`,
    "AREAFORGE_AUTO_APPLY=none",
    "AREAFORGE_REQUIRE_SIGNATURE=true",
  ].join("\n") + "\n");
  const updater = path.join(bin, "mock-updater");
  writeFileSync(updater, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${updaterLog}"\nprevious=""\nidentity_path=""\nfor arg in "$@"; do\n  if [[ "$previous" == "--request-guard" && ! -f "$arg" ]]; then exit 9; fi\n  if [[ "$previous" == "--identity-json" ]]; then identity_path="$arg"; fi\n  previous="$arg"\ndone\nif [[ -f "${updaterMode}" && "$(<"${updaterMode}")" == "guard-reject" ]]; then\n  printf '%s\\n' 'arbitrary reasonCode=WRONG_TEXT executionAttempted=true'\n  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=first result=pass reasonCode=EXPECTED_BEFORE_MATCH observedBeforeHash=sha256:${"1".repeat(64)} executionAttempted=false'\n  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=second result=reject reasonCode=EXPECTED_BEFORE_MISMATCH observedBeforeHash=sha256:${"2".repeat(64)} executionAttempted=false'\n  exit 17\nfi\nif [[ -n "$identity_path" ]]; then printf '%s\\n' '{"releaseId":42,"manifestSha256":"sha256:${"c".repeat(64)}","manifestVersion":"0.1.8","webImageDigest":"${targetImage}"}' > "$identity_path"; fi\n`);
  chmodSync(updater, 0o755);
  const docker = path.join(bin, "docker");
  writeFileSync(docker, `#!/usr/bin/env bash\n[[ -f "${productionLockMarker}" ]] || { printf '%s\\n' 'LOCK_NOT_HELD' >> "${dockerLog}"; exit 88; }\nprintf '%s\\n' "$*" >> "${dockerLog}"\n`);
  chmodSync(docker, 0o755);
  const flock = path.join(bin, "flock");
  writeFileSync(flock, `#!/usr/bin/env bash\nif [[ "\${TEST_USE_SYSTEM_FLOCK:-0}" == "1" ]]; then exec "${systemFlock || "/usr/bin/false"}" "$@"; fi\nprintf '%s\\n' "$*" >> "${flockLog}"\nif [[ "$1" == "-n" && "\${2:-}" == "8" ]]; then touch "${productionLockMarker}"; fi\nif [[ "$1" == "-u" && "\${2:-}" == "8" ]]; then rm -f "${productionLockMarker}"; fi\nexit 0\n`);
  chmodSync(flock, 0o755);
  return { dir, state, records, bin, envFile, configFile, updater, updaterLog, updaterMode, dockerLog, flockLog, productionLockMarker };
}

function run(f: Fixture): void {
  runAgent(f, [agent]);
}

function runWithSecondComparisonDrift(f: Fixture): void {
  runAgent(f, ["-c", `. "$1"\nbefore_second_comparison() { config_set AREAFORGE_AUTO_APPLY minor; }\nmain`, "selftest", agent], {
    AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
  });
}

function crashAfterExecutionBoundary(f: Fixture): void {
  const result = spawnSync("bash", ["-c", `. "$1"
run_updater_apply() {
  printf '%s\\n' simulated-side-effect >> "$AREAFORGE_TEST_UPDATER_LOG"
  printf '%s\\n' 'AREAFORGE_REQUEST_GUARD phase=second result=pass reasonCode=EXPECTED_BEFORE_MATCH observedBeforeHash=sha256:${"2".repeat(64)} executionAttempted=true'
  kill -KILL "$$"
}
main`, "selftest", agent], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH ?? ""}`,
      AREAFORGE_UPDATE_AGENT_LIB_ONLY: "1",
      AREAFORGE_UPDATE_AGENT_TEST_MODE: "1",
      AREAFORGE_UPDATE_AGENT_CONFIG: f.configFile,
      AREAFORGE_OPS_STATE_DIR: f.state,
      AREAFORGE_UPDATER_PATH: f.updater,
      AREAFORGE_UPDATE_AGENT_NOW_EPOCH: String(nowEpoch),
      AREAFORGE_UPDATE_AGENT_CLAIM_TTL_SECONDS: "60",
      AREAFORGE_TEST_UPDATER_LOG: f.updaterLog,
    },
    encoding: "utf8",
  });
  assert(result.signal === "SIGKILL", `crash fixture must kill the agent after the execution boundary, got ${result.signal ?? result.status}`);
}

function runAgent(f: Fixture, args: string[], extraEnv: Record<string, string> = {}): void {
  execFileSync("bash", args, {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH ?? ""}`,
      AREAFORGE_UPDATE_AGENT_TEST_MODE: "1",
      AREAFORGE_UPDATE_AGENT_CONFIG: f.configFile,
      AREAFORGE_OPS_STATE_DIR: f.state,
      AREAFORGE_UPDATER_PATH: f.updater,
      AREAFORGE_UPDATE_AGENT_NOW_EPOCH: String(nowEpoch),
      AREAFORGE_UPDATE_AGENT_CLAIM_TTL_SECONDS: "60",
      ...extraEnv,
    },
    stdio: "pipe",
  });
}

function testSnapshotAndCheck(): void {
  const f = fixture();
  enqueue(f, request("check"));
  run(f);
  const status = json(path.join(f.state, "status.json"));
  assert(status.snapshotSchemaVersion === 2, "status snapshot schema must be V2");
  assert(status.verifiedTarget?.releaseId === 42, "status must consume updater verified identity");
  const projection = {
    currentVersion: status.currentVersion,
    currentImage: status.currentImage,
    autoApply: status.autoApply,
    signatureRequired: status.signatureRequired,
    verifiedTarget: status.verifiedTarget,
    rollback: {
      available: status.rollback.available,
      targetVersion: status.rollback.targetVersion,
      targetImage: status.rollback.targetImage,
      sourceRecordSha256: status.rollback.sourceRecordSha256,
    },
  };
  assert(status.snapshotHash === hash(stable(projection)), "snapshotHash must match canonical projection");
}

function testHashRejectionHasNoExecution(): void {
  const f = fixture();
  const value = request("apply");
  value.requestHash = `sha256:${"0".repeat(64)}`;
  enqueue(f, value);
  run(f);
  assert(!existsSync(f.updaterLog), "hash rejection must not call updater");
  assert(!existsSync(f.dockerLog), "hash rejection must not call docker");
  assert(decisions(f).some((item) => item.reasonCode === "REQUEST_HASH_MISMATCH" && item.executionAttempted === false), "hash rejection decision missing");
}

function testLegacyMutationFailsClosed(): void {
  const f = fixture();
  const id = `update_${nowEpoch}_${randomUUID()}`;
  enqueueRaw(f, id, { id, action: "rollback", status: "queued", requestedAt: iso(nowEpoch), finishedAt: null, message: null, actorEmailHash: "d".repeat(64) });
  run(f);
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "legacy mutation rejection must have zero execution calls");
  assert(decisions(f).some((item) => item.reasonCode === "LEGACY_MUTATION_UNBOUND"), "legacy mutation reason missing");
}

function testApplyUsesClaimedRequestGuard(): void {
  const f = fixture();
  enqueue(f, request("apply"));
  run(f);
  const invocation = readFileSync(f.updaterLog, "utf8");
  assert(invocation.includes("apply --yes --tag v0.1.8"), "apply invocation missing");
  assert(invocation.includes("--request-guard") && invocation.includes("/processing/"), "apply must point guard at root-only claimed request");
}

function testApplyGuardRejectionHasNoExecution(): void {
  const f = fixture();
  writeFileSync(f.updaterMode, "guard-reject\n");
  enqueue(f, request("apply"));
  run(f);
  const decision = decisions(f).find((item) => item.reasonCode === "EXPECTED_BEFORE_MISMATCH");
  assert(decision?.executionAttempted === false, "explicit updater guard rejection must record executionAttempted=false");
  assert(decision?.observedBeforeHashFirst === `sha256:${"1".repeat(64)}`, "first guard hash must come from the explicit marker");
  assert(decision?.observedBeforeHashSecond === `sha256:${"2".repeat(64)}`, "second guard hash must come from the explicit marker");
  assert(!existsSync(f.dockerLog), "apply guard rejection must have zero docker side effects");
}

function testIdempotentReplayDoesNotExecuteAgain(): void {
  const f = fixture();
  const key = randomUUID();
  enqueue(f, request("check", key));
  run(f);
  const firstCount = lines(f.updaterLog);
  enqueue(f, request("check", key));
  run(f);
  assert(lines(f.updaterLog) === firstCount, "idempotent replay must not call updater again");
  assert(decisions(f).some((item) => item.reasonCode === "IDEMPOTENT_REPLAY" && item.executionAttempted === false), "idempotent replay decision missing");
}

function testIdempotentReplayPreservesRejectedTerminalState(): void {
  const f = fixture();
  const key = randomUUID();
  const rejected = request("apply", key);
  rejected.requestHash = `sha256:${"0".repeat(64)}`;
  enqueue(f, rejected);
  run(f);

  const valid = request("apply", key);
  enqueue(f, valid);
  run(f);

  const replay = decisions(f).find((item) => item.id === valid.id && item.reasonCode === "IDEMPOTENT_REPLAY");
  assert(replay?.status === "failed" && replay.executionAttempted === false, "idempotent replay must preserve the existing rejected terminal state");
  assert(!existsSync(f.updaterLog), "replay of a rejected terminal decision must not call updater");
}

function testRollbackUsesExactSourceRecordUnderLock(): void {
  const f = fixture();
  const rollbackVersion = "0.1.6";
  const rollbackImage = `ghcr.io/areasong/areaforge-web:v${rollbackVersion}@sha256:${"9".repeat(64)}`;
  const record = path.join(f.records, "20270115T080000Z", "update-record.txt");
  mkdirSync(path.dirname(record), { recursive: true });
  writeFileSync(record, `previousAppVersion: ${rollbackVersion}\npreviousImage: ${rollbackImage}\n`);
  const sourceRecordSha256 = fileHash(record);
  enqueue(f, request("rollback", randomUUID(), {
    rollbackTargetVersion: rollbackVersion,
    rollbackTargetImage: rollbackImage,
    rollbackSourceRecordSha256: sourceRecordSha256,
  }));
  run(f);
  const decision = decisions(f).find((item) => item.action === "rollback");
  assert(decision?.decision === "SUCCEEDED" && decision.executionAttempted === true, "rollback must succeed with execution evidence");
  assert(decision?.expectedBefore.rollbackSourceRecordSha256 === sourceRecordSha256, "rollback decision must retain the exact source record hash");
  assert(readFileSync(f.envFile, "utf8").includes(`AREAFORGE_IMAGE=${rollbackImage}`), "rollback must apply the bound image");
  assert(!readFileSync(f.dockerLog, "utf8").includes("LOCK_NOT_HELD"), "rollback side effect must run while the shared lock is held");
}

function testPolicySuccessUnderLock(): void {
  const f = fixture();
  enqueue(f, request("set_auto_apply"));
  run(f);
  const decision = decisions(f).find((item) => item.action === "set_auto_apply");
  assert(decision?.decision === "SUCCEEDED" && decision.executionAttempted === true, "policy mutation must record successful execution");
  assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "patch", "policy mutation must persist the requested value");
  assert(readFileSync(f.flockLog, "utf8").includes("-n 8\n-u 8"), "policy dual compare and mutation must be enclosed by the shared lock");
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "policy mutation must not call updater or docker");
}

function testFirstComparisonMismatchHasNoSideEffects(): void {
  const f = fixture();
  enqueue(f, request("set_auto_apply", randomUUID(), { autoApply: "minor" }));
  run(f);
  const decision = decisions(f).find((item) => item.reasonCode === "EXPECTED_BEFORE_MISMATCH");
  assert(decision?.executionAttempted === false, "first comparison mismatch must record executionAttempted=false");
  assert(decision?.observedBeforeHashFirst && decision.observedBeforeHashSecond === null, "first mismatch must stop before the second comparison");
  assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "none", "first mismatch must not change policy");
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "first mismatch must have zero external side effects");
}

function testSecondComparisonDriftHasNoSideEffects(): void {
  const f = fixture();
  enqueue(f, request("set_auto_apply"));
  runWithSecondComparisonDrift(f);
  const decision = decisions(f).find((item) => item.reasonCode === "EXPECTED_BEFORE_MISMATCH");
  assert(decision?.executionAttempted === false, "second comparison drift must record executionAttempted=false");
  assert(decision?.observedBeforeHashFirst && decision.observedBeforeHashSecond, "second comparison drift must retain both observed hashes");
  assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "minor", "drift fixture must not be overwritten by the requested patch policy");
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "second comparison drift must have zero external side effects");
}

function testInvalidRequestIdCannotEscapeHistory(): void {
  const f = fixture();
  enqueueRaw(f, "invalid-request", {
    schemaVersion: 2,
    id: "../requests/escaped",
    action: "apply",
  });
  run(f);
  assert(readdirSync(path.join(f.state, "requests")).length === 0, "invalid request id must not create a queue file outside history");
  const historyFiles = readdirSync(path.join(f.state, "history"));
  assert(historyFiles.length === 1 && historyFiles[0]?.startsWith("invalid_"), "invalid request history must use a derived safe path component");
  assert(decisions(f).some((item) => item.reasonCode === "INVALID_REQUEST_SCHEMA"), "invalid request must still produce immutable rejection history");
}

function testInvalidClaimIdCannotEscapeHistory(): void {
  const f = fixture();
  const value = request("apply");
  const claimDir = path.join(f.state, "processing", "c".repeat(32));
  mkdirSync(claimDir, { recursive: true });
  writeFileSync(path.join(claimDir, `${value.id}.json`), JSON.stringify(value));
  writeFileSync(path.join(claimDir, "claim.json"), JSON.stringify({
    claimId: "../../requests/claim-escaped",
    claimedAt: iso(nowEpoch - 120),
    claimExpiresAt: iso(nowEpoch - 60),
    originalFileName: `${value.id}.json`,
  }));
  run(f);
  assert(readdirSync(path.join(f.state, "requests")).length === 0, "invalid claim id must not create a file outside history");
  const historyFiles = readdirSync(path.join(f.state, "history"));
  assert(historyFiles.length === 1 && historyFiles[0]?.includes(".claim_"), "invalid claim id must use a derived safe history component");
  assert(decisions(f).some((item) => item.reasonCode === "STALE_PROCESSING_CLAIM"), "invalid stale claim must still require reconciliation");
}

function testActiveProcessingClaimBlocksQueue(): void {
  const f = fixture();
  const inFlight = request("apply");
  const queued = request("apply", inFlight.idempotencyKey);
  const claimDir = path.join(f.state, "processing", "b".repeat(32));
  mkdirSync(claimDir, { recursive: true });
  writeFileSync(path.join(claimDir, `${inFlight.id}.json`), JSON.stringify(inFlight));
  writeFileSync(path.join(claimDir, "claim.json"), JSON.stringify({
    claimId: "b".repeat(32),
    claimedAt: iso(nowEpoch - 30),
    claimExpiresAt: iso(nowEpoch + 30),
    originalFileName: `${inFlight.id}.json`,
  }));
  enqueue(f, queued);
  run(f);
  assert(existsSync(path.join(f.state, "requests", `${queued.id}.json`)), "active processing claim must leave later queued mutations untouched");
  assert(existsSync(claimDir), "active processing claim must remain available for later reconciliation");
  assert(decisions(f).length === 0, "active processing claim must not synthesize a terminal decision before TTL expiry");
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "active processing claim must block duplicate external side effects");
}

function testCrashAfterExecutionBoundaryNeedsReconciliation(): void {
  const f = fixture();
  const inFlight = request("apply");
  enqueue(f, inFlight);
  crashAfterExecutionBoundary(f);
  assert(lines(f.updaterLog) === 1, "crash fixture must cross the simulated execution boundary exactly once");
  assert(decisions(f).length === 0, "a killed agent must leave the claimed request without a fabricated terminal decision");

  const duplicate = request("apply", inFlight.idempotencyKey);
  enqueue(f, duplicate);
  run(f);
  assert(lines(f.updaterLog) === 1, "restart before claim expiry must not replay the mutation");
  assert(existsSync(path.join(f.state, "requests", `${duplicate.id}.json`)), "restart before claim expiry must leave the duplicate queued");

  runAgent(f, [agent], { AREAFORGE_UPDATE_AGENT_NOW_EPOCH: String(nowEpoch + 61) });
  assert(lines(f.updaterLog) === 1, "stale reconciliation and idempotent replay must not execute the updater again");
  assert(decisions(f).some((item) => item.reasonCode === "STALE_PROCESSING_CLAIM" && item.executionAttempted === null), "post-crash stale claim must record unknown execution state");
}

function testRealProductionLockContention(): void {
  if (!systemFlock) return;
  for (const action of ["rollback", "set_auto_apply"] as const) {
    const f = fixture();
    const lockFile = path.join(f.dir, ".areaforge-production-state.lock");
    const readyFile = path.join(f.dir, `lock-ready-${action}`);
    const holder = spawn(systemFlock, [lockFile, "bash", "-c", `printf ready > '${readyFile}'; sleep 5`], { stdio: "ignore" });
    try {
      waitForFile(readyFile);
      enqueue(f, request(action));
      runAgent(f, [agent], { TEST_USE_SYSTEM_FLOCK: "1" });
      const decision = decisions(f).find((item) => item.reasonCode === "PRODUCTION_STATE_LOCK_BUSY");
      assert(decision?.executionAttempted === false, `${action} must fail closed under real production-state lock contention`);
      assert(configValue(f, "AREAFORGE_AUTO_APPLY") === "none", `${action} lock contention must not change updater policy`);
      assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), `${action} lock contention must not reach external side effects`);
    } finally {
      holder.kill("SIGTERM");
    }
  }
}

function testStaleProcessingNeedsReconciliation(): void {
  const f = fixture();
  const value = request("apply");
  const claimDir = path.join(f.state, "processing", "stale-claim");
  mkdirSync(claimDir, { recursive: true });
  writeFileSync(path.join(claimDir, `${value.id}.json`), JSON.stringify(value));
  writeFileSync(path.join(claimDir, "claim.json"), JSON.stringify({
    claimId: "stale-claim",
    claimedAt: iso(nowEpoch - 120),
    claimExpiresAt: iso(nowEpoch - 60),
    originalFileName: `${value.id}.json`,
  }));
  run(f);
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "stale processing reconciliation must not replay execution");
  assert(decisions(f).some((item) => item.decision === "NEEDS_RECONCILIATION" && item.reasonCode === "STALE_PROCESSING_CLAIM" && item.executionAttempted === null), "stale claim must record unknown execution state");
}

function testMissingClaimMetadataNeedsReconciliation(): void {
  const f = fixture();
  const value = request("apply");
  const claimDir = path.join(f.state, "processing", "a".repeat(32));
  mkdirSync(claimDir, { recursive: true });
  writeFileSync(path.join(claimDir, `${value.id}.json`), JSON.stringify(value));
  run(f);
  assert(!existsSync(f.updaterLog) && !existsSync(f.dockerLog), "missing claim metadata reconciliation must not replay execution");
  assert(decisions(f).some((item) => item.decision === "NEEDS_RECONCILIATION" && item.reasonCode === "MISSING_CLAIM_METADATA" && item.executionAttempted === null && item.claimMetadataSynthetic === true), "missing claim metadata decision must use a synthetic claim record");
}

function request(action: Action, idempotencyKey = randomUUID(), expectedOverrides: Record<string, unknown> = {}): Record<string, any> {
  const id = `update_${nowEpoch}_${randomUUID()}`;
  const expectedBefore = {
    currentVersion,
    currentImage,
    autoApply: "none",
    signatureRequired: true,
    rollbackTargetVersion: null,
    rollbackTargetImage: null,
    rollbackSourceRecordSha256: null,
    ...expectedOverrides,
  };
  const params = { tag: action === "apply" ? "v0.1.8" : null, autoApply: action === "set_auto_apply" ? "patch" : null };
  const target = action === "apply"
    ? { releaseId: 42, manifestSha256: `sha256:${"c".repeat(64)}`, manifestVersion: "0.1.8", webImageDigest: targetImage }
    : { releaseId: null, manifestSha256: null, manifestVersion: null, webImageDigest: null };
  const value: Record<string, any> = {
    schemaVersion: 2,
    id,
    action,
    status: "queued",
    requestedAt: iso(nowEpoch - 5),
    expiresAt: iso(nowEpoch + (action === "check" ? 895 : 295)),
    actorEmailHash: "d".repeat(64),
    idempotencyKey,
    params,
    target,
    expectedBefore,
    expectedBeforeHash: "",
    semanticHash: "",
    requestHash: "",
  };
  value.expectedBeforeHash = hash(stable({ domain: "areaforge.update-request.expected-before.v2", expectedBefore }));
  value.semanticHash = hash(stable({ domain: "areaforge.update-request.semantic.v2", action, params, target, expectedBefore }));
  value.requestHash = hash(stable({
    domain: "areaforge.update-request.v2",
    schemaVersion: value.schemaVersion,
    id,
    action,
    requestedAt: value.requestedAt,
    expiresAt: value.expiresAt,
    actorEmailHash: value.actorEmailHash,
    idempotencyKey,
    params,
    target,
    expectedBefore,
    expectedBeforeHash: value.expectedBeforeHash,
    semanticHash: value.semanticHash,
  }));
  return value;
}

function enqueue(f: Fixture, value: Record<string, any>): void {
  enqueueRaw(f, value.id, value);
}

function enqueueRaw(f: Fixture, id: string, value: unknown): void {
  writeFileSync(path.join(f.state, "requests", `${id}.json`), `${JSON.stringify(value)}\n`);
}

function decisions(f: Fixture): Array<Record<string, any>> {
  const dir = path.join(f.state, "history");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".decision.json")).map((name) => json(path.join(dir, name)));
}

function json(file: string): Record<string, any> {
  return JSON.parse(readFileSync(file, "utf8"));
}

function lines(file: string): number {
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).length : 0;
}

function configValue(f: Fixture, key: string): string | undefined {
  return readFileSync(f.configFile, "utf8").split("\n").find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
}

function iso(epoch: number): string {
  return new Date(epoch * 1000).toISOString();
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fileHash(file: string): string {
  return hash(readFileSync(file, "utf8"));
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}

function waitForFile(file: string): void {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (existsSync(file)) return;
    Atomics.wait(sleeper, 0, 0, 25);
  }
  throw new Error(`FAIL: timed out waiting for ${file}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

type Fixture = {
  dir: string;
  state: string;
  records: string;
  bin: string;
  envFile: string;
  configFile: string;
  updater: string;
  updaterLog: string;
  updaterMode: string;
  dockerLog: string;
  flockLog: string;
  productionLockMarker: string;
};

main();
